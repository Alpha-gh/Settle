import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentPort, AgentRunResult, Snapshot } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import { AuditEventRepository } from '../src/db/repositories.js';
import {
  setAgentInstance,
  resetAgentInstance,
  setLastLlmError,
} from '../src/adapters/agent.js';
import { resetCachedEnv } from '../src/config/env.js';

describe('Debug LLM Endpoints & Fallback Telemetry (Items 2a, 3)', () => {
  let app: FastifyInstance;
  const auditRepo = new AuditEventRepository();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_VERIFY = 'false';
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = 'gemini-1.5-flash';
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKey1234567890abcdefg';
    resetCachedEnv();

    await setupTestDatabase();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    resetAgentInstance();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('GET /api/debug/llm returns provider info and hasKey boolean without leaking keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/debug/llm',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.provider).toBe('gemini');
    expect(body.model).toBe('gemini-1.5-flash');
    expect(body.hasKey).toBe(true);
    expect(body.agentImpl).toBeDefined();
    expect(body.engineImpl).toBeDefined();

    // Verify raw key or substring is never returned in response payload
    expect(res.payload).not.toContain('AIzaSyTestSecretKey1234567890abcdefg');
    expect(res.payload).not.toContain('AIzaSy');
  });

  it('POST /api/debug/llm/ping returns latencyMs and ok: true on successful ping with mocked HTTP layer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ reply: 'ok' }) }],
            },
          },
        ],
      }),
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/debug/llm/ping',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(body.message).toBe('ok');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('POST /api/debug/llm/ping redacts secrets and query strings on upstream failures', async () => {
    const secretKey = 'AIzaSySecretPingKey99999999999999999';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () =>
        `Request failed at https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${secretKey}: quota exceeded`,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/debug/llm/ping',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(false);
    expect(body.status).toBe(403);
    expect(res.payload).not.toContain(secretKey);
    expect(res.payload).not.toContain('key=AIzaSy');
    expect(body.message).toContain('?[REDACTED]');
  });

  it('POST /api/debug/llm/ping is rate limited under heavy request load', async () => {
    // Max is 10/min
    for (let i = 0; i < 10; i++) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ reply: 'ok' }) }],
              },
            },
          ],
        }),
      } as any);

      await app.inject({
        method: 'POST',
        url: '/api/debug/llm/ping',
        headers: { 'x-test-rate-limit': 'true' },
      });
    }

    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/debug/llm/ping',
      headers: { 'x-test-rate-limit': 'true' },
    });

    expect(rateLimited.statusCode).toBe(429);
    const body = JSON.parse(rateLimited.payload);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('POST /api/agent/run appends agent.llm_fallback audit event with redacted info when fallback occurs', async () => {
    // Seed database first
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });

    const secretInError = 'AIzaSySensitiveLeakToken1234567890123';

    class FallbackTestAgent implements AgentPort {
      async runCycle(snapshot: Snapshot): Promise<AgentRunResult> {
        setLastLlmError({
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          status: 400,
          errorMessage: `Failed at https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${secretInError}: Bad Request`,
        });

        return {
          runId: 'run_test_fallback_1',
          actions: [
            {
              id: 'act_test_fallback_1',
              invoiceId: snapshot.invoices[0]!.id,
              type: 'SEND_REMINDER',
              params: { note: 'Please pay promptly' },
              reason:
                'Overdue invoice reminder [via provider=gemini; model=gemini-1.5-flash; path=fallback]',
              simulation: undefined,
              policy: { allowed: true, requiresApproval: true },
              status: 'AWAITING_APPROVAL',
              createdAt: new Date().toISOString(),
            },
          ],
          skipped: [],
        };
      }
      async chat(): Promise<any> {
        return { text: 'ok' };
      }
    }

    setAgentInstance(new FallbackTestAgent());

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });

    expect(res.statusCode).toBe(200);

    const audits = await auditRepo.list(50);
    const fallbackAudit = audits.find((a) => a.kind === 'agent.llm_fallback');

    expect(fallbackAudit).toBeDefined();
    expect(fallbackAudit?.actor).toBe('agent');
    expect(fallbackAudit?.detail).toBeDefined();

    const detail = fallbackAudit?.detail as any;
    expect(detail.provider).toBe('gemini');
    expect(detail.model).toBe('gemini-1.5-flash');
    expect(detail.status).toBe(400);

    // Verify secret and query string are redacted in stored audit event
    expect(detail.error).not.toContain(secretInError);
    expect(detail.error).not.toContain('key=AIzaSy');
    expect(detail.error).toContain('?[REDACTED]');
  });
});
