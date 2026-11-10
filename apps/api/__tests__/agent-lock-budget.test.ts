import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditEvent } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import { resetCachedEnv } from '../src/config/env.js';
import {
  resetAgentInstance,
  setAgentInstance,
  resetAgentRunLock,
  setAgentRunLockForTest,
  setLastLlmError,
} from '../src/adapters/agent.js';
import { resetEngineInstance } from '../src/adapters/engine.js';
import { StubAgent } from '../src/adapters/stubs.js';

describe('Agent Lock Safety, Status Endpoint, and Error Recovery', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENGINE_IMPL = 'real';
    process.env.AGENT_IMPL = 'real';
    process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
    process.env.AGENT_RUN_LOCK_TTL_SECONDS = '150';
    process.env.AGENT_FALLBACK_TO_STUB = 'false';
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;

    resetCachedEnv();
    resetEngineInstance();
    resetAgentInstance();
    resetAgentRunLock();

    await setupTestDatabase();
    process.env.WEBHOOK_VERIFY = 'false';

    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    resetEngineInstance();
    resetAgentInstance();
    resetAgentRunLock();
    resetCachedEnv();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('GET /api/agent/status returns idle state and active state + 409 metadata during run', async () => {
    resetAgentRunLock();
    const idleRes = await app.inject({ method: 'GET', url: '/api/agent/status' });
    expect(idleRes.statusCode).toBe(200);
    expect(JSON.parse(idleRes.payload)).toEqual({
      running: false,
      startedAt: null,
      ageSeconds: 0,
    });

    const slowAgent = {
      async runCycle(snapshot: any) {
        await new Promise((r) => setTimeout(r, 250));
        return new StubAgent().runCycle(snapshot);
      },
      async chat(q: string, s: any) {
        return new StubAgent().chat(q, s);
      },
    };
    setAgentInstance(slowAgent as any);

    try {
      const run1Promise = app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });

      await new Promise((r) => setTimeout(r, 40));

      const statusDuring = await app.inject({
        method: 'GET',
        url: '/api/agent/status',
      });
      expect(statusDuring.statusCode).toBe(200);
      const statusBody = JSON.parse(statusDuring.payload);
      expect(statusBody.running).toBe(true);
      expect(typeof statusBody.startedAt).toBe('string');
      expect(typeof statusBody.ageSeconds).toBe('number');
      expect(statusBody.ageSeconds).toBeGreaterThanOrEqual(0);

      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });
      expect(conflictRes.statusCode).toBe(409);
      const conflictBody = JSON.parse(conflictRes.payload);
      expect(conflictBody.error.code).toBe('AGENT_RUN_IN_PROGRESS');
      expect(typeof conflictBody.error.startedAt).toBe('string');
      expect(typeof conflictBody.error.ageSeconds).toBe('number');

      const run1Res = await run1Promise;
      expect(run1Res.statusCode).toBe(200);

      const statusAfter = await app.inject({
        method: 'GET',
        url: '/api/agent/status',
      });
      expect(JSON.parse(statusAfter.payload)).toEqual({
        running: false,
        startedAt: null,
        ageSeconds: 0,
      });
    } finally {
      resetAgentInstance();
      resetAgentRunLock();
    }
  });

  it('recovers automatically from a stale run lock older than TTL and releases lock afterward', async () => {
    const staleStartedAtMs = Date.now() - 200_000;
    setAgentRunLockForTest(staleStartedAtMs);
    setAgentInstance(new StubAgent());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });
      expect(res.statusCode).toBe(200);

      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/agent/status',
      });
      expect(JSON.parse(statusRes.payload).running).toBe(false);
    } finally {
      resetAgentInstance();
      resetAgentRunLock();
    }
  });

  it('releases the run lock in finally when runCycle throws', async () => {
    resetAgentRunLock();
    const failingAgent = {
      async runCycle() {
        throw new Error('Simulated agent crash');
      },
      async chat() {
        throw new Error('Simulated chat crash');
      },
    };
    setAgentInstance(failingAgent as any);

    try {
      const failRes = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });
      expect(failRes.statusCode).toBe(502);

      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/agent/status',
      });
      expect(JSON.parse(statusRes.payload)).toEqual({
        running: false,
        startedAt: null,
        ageSeconds: 0,
      });

      // Subsequent run must succeed immediately because lock was released
      setAgentInstance(new StubAgent());
      const recoverRes = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });
      expect(recoverRes.statusCode).toBe(200);
    } finally {
      resetAgentInstance();
      resetAgentRunLock();
    }
  });

  it('records a single agent.llm_fallback audit event when 429 rate-limit triggers fallback', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });

    const rateLimitedStub = {
      async runCycle(snapshot: any) {
        setLastLlmError({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          status: 429,
          errorMessage: 'LLM HTTP Error 429 (Too Many Requests): RESOURCE_EXHAUSTED',
        });
        const res = await new StubAgent().runCycle(snapshot);
        res.actions = res.actions.map((a, idx) =>
          idx === 0
            ? {
                ...a,
                reason: `${a.reason} [via provider=gemini; model=gemini-2.5-flash; path=fallback]`,
              }
            : { ...a, reason: `${a.reason} [via rules; path=rules]` },
        );
        return res;
      },
      async chat(q: string, s: any) {
        return new StubAgent().chat(q, s);
      },
    };
    setAgentInstance(rateLimitedStub as any);

    try {
      const beforeAuditRes = await app.inject({ method: 'GET', url: '/api/audit' });
      const beforeAudit: AuditEvent[] = JSON.parse(beforeAuditRes.payload);
      const beforeFallbackCount = beforeAudit.filter(
        (e) => e.kind === 'agent.llm_fallback',
      ).length;

      const runRes = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });
      expect(runRes.statusCode).toBe(200);

      const afterAuditRes = await app.inject({ method: 'GET', url: '/api/audit' });
      const afterAudit: AuditEvent[] = JSON.parse(afterAuditRes.payload);
      const fallbackEvents = afterAudit.filter(
        (e) => e.kind === 'agent.llm_fallback',
      );
      expect(fallbackEvents.length).toBe(beforeFallbackCount + 1);
      expect(fallbackEvents[0]!.summary).toContain('status=429');
    } finally {
      resetAgentInstance();
      resetAgentRunLock();
    }
  });
});

