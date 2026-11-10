import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';

describe('Hardening, Security & Deployment Features (Stage 5)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await setupTestDatabase();
    process.env.WEBHOOK_VERIFY = 'false';

    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('GET /health checks Postgres and returns 200 with status ok and database connected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('GET / returns the HTML landing page or built SPA with 200 and never a bare 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const isSpa = res.payload.includes('<div id="root"></div>');
    const isFallback = res.payload.includes('Settle Core API');
    expect(isSpa || isFallback).toBe(true);
    if (isSpa) {
      expect(res.payload).toContain('Settle');
      // SPA client routes also resolve to index.html
      const routeRes = await app.inject({ method: 'GET', url: '/receivables' });
      expect(routeRes.statusCode).toBe(200);
      expect(routeRes.headers['content-type']).toContain('text/html');
      expect(routeRes.payload).toContain('<div id="root"></div>');
    } else {
      expect(res.payload).toContain('/health');
      expect(res.payload).toContain('/api/dashboard');
    }
  });

  it('sets security headers via Helmet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('rate limits POST routes when rate limit is active and returns RATE_LIMIT_EXCEEDED', async () => {
    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-test-rate-limit': 'true' },
      payload: { question: 'hello' },
    });
    console.log('FIRST CALL STATUS:', firstRes.statusCode, 'PAYLOAD:', firstRes.payload);

    // Send 59 more requests with x-test-rate-limit header
    for (let i = 1; i < 60; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-test-rate-limit': 'true' },
        payload: { question: 'hello' },
      });
    }

    // 61st request should be rate-limited
    const rateLimitedRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-test-rate-limit': 'true' },
      payload: { question: 'hello' },
    });

    expect(rateLimitedRes.statusCode).toBe(429);
    const body = JSON.parse(rateLimitedRes.payload);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('POST /api/demo/* routes are not blocked by rate limiting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/demo/reset',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects payloads larger than 1MB with 413', async () => {
    const hugeString = 'x'.repeat(1024 * 1024 + 100); // > 1MB
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question: hugeString },
    });
    expect(res.statusCode).toBe(413);
  });

  it('allows burst of 30 parallel asset GETs with Origin header and WEB_ORIGIN=* in production mode', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevWebOrigin = process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = '*';

    const prodApp = await buildApp();
    await prodApp.ready();
    try {
      const homeRes = await prodApp.inject({ method: 'GET', url: '/' });
      expect(homeRes.statusCode).toBe(200);
      const assetUrls = [...homeRes.payload.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
        (m) => m[1]!,
      );
      expect(assetUrls.length).toBeGreaterThan(0);

      // Burst 30 parallel GETs with crossorigin Origin header and rate-limit active
      const burstTargets = Array.from({ length: 30 }, (_, i) => assetUrls[i % assetUrls.length]!);
      const burstResults = await Promise.all(
        burstTargets.map((url) =>
          prodApp.inject({
            method: 'GET',
            url,
            headers: {
              origin: 'https://settle-api-r8pd.onrender.com',
              referer: 'https://settle-api-r8pd.onrender.com/',
              'accept-encoding': 'gzip, br',
              'sec-fetch-mode': 'cors',
              'x-test-rate-limit': 'true',
            },
          }),
        ),
      );
      for (const r of burstResults) {
        expect(r.statusCode).toBe(200);
      }

      // Verify all main page assets still return 200 with expected content types
      for (const url of assetUrls) {
        const assetRes = await prodApp.inject({
          method: 'GET',
          url,
          headers: {
            origin: 'https://settle-api-r8pd.onrender.com',
            'x-test-rate-limit': 'true',
          },
        });
        expect(assetRes.statusCode).toBe(200);
        if (url.endsWith('.css')) {
          expect(assetRes.headers['content-type']).toContain('text/css');
        } else if (url.endsWith('.js')) {
          expect(assetRes.headers['content-type']).toContain('javascript');
        }
      }
    } finally {
      await prodApp.close();
      process.env.NODE_ENV = prevNodeEnv;
      process.env.WEB_ORIGIN = prevWebOrigin;
    }
  });

  it('POST burst on /api/demo/* returns clean 429 JSON after stricter limit', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/demo/reset',
        headers: { 'x-test-rate-limit': 'true', 'x-forwarded-for': '10.0.0.99' },
        payload: {},
      });
      expect(r.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/demo/reset',
      headers: { 'x-test-rate-limit': 'true', 'x-forwarded-for': '10.0.0.99' },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    const body = JSON.parse(limited.payload);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
