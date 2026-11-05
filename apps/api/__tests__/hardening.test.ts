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

  it('GET / returns the HTML landing page with 200 and never a bare 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Settle Core API');
    expect(res.payload).toContain('/health');
    expect(res.payload).toContain('/api/dashboard');
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
});
