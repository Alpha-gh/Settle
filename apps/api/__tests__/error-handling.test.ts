import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb, getRawSql } from '../src/db/index.js';
import { resetCachedEnv } from '../src/config/env.js';

describe('Request vs Response Validation Error Handling (Item 3)', () => {
  let app: FastifyInstance;
  const logLines: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENGINE_IMPL = 'real';
    process.env.AGENT_IMPL = 'stub';
    resetCachedEnv();

    await setupTestDatabase();

    const captureStream = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of chunk.toString().split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            logLines.push(JSON.parse(trimmed));
          } catch {
            // ignore non-json lines
          }
        }
        callback();
      },
    });

    app = await buildApp({ loggerStream: captureStream });
    await app.ready();
  });

  afterAll(async () => {
    resetCachedEnv();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('returns 400 VALIDATION_ERROR for request parsing failures', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 INTERNAL_ERROR (never 400) for response schema failures and logs route, reqId, and issue details', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    const sql = getRawSql();
    logLines.length = 0;

    try {
      // Corrupt business currency directly in DB to trigger response schema validation failure on GET /api/dashboard
      await sql.unsafe(`UPDATE businesses SET currency = 'EUR'`);

      const res = await app.inject({
        method: 'GET',
        url: '/api/dashboard',
      });

      expect(res.statusCode).toBe(500);
      expect(res.statusCode).not.toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('INTERNAL_ERROR');

      const errorLogs = logLines.filter((l) => l.level === 50 && l.route === 'GET /api/dashboard');
      expect(errorLogs.length).toBe(1);
      const entry = errorLogs[0]!;
      expect(entry.reqId).toBeDefined();
      expect(entry.route).toBe('GET /api/dashboard');
      const issues = entry.issues as Array<{ path: string; message: string }>;
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.some((i) => i.path === 'business.currency' && i.message.length > 0)).toBe(true);
    } finally {
      await sql.unsafe(`UPDATE businesses SET currency = 'USD'`);
    }
  });
});

