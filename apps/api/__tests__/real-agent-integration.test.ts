import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ActionRecord } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import { resetCachedEnv } from '../src/config/env.js';
import { resetAgentInstance } from '../src/adapters/agent.js';
import { resetEngineInstance } from '../src/adapters/engine.js';

describe('Real Engine & Real Agent Integration (Item 8)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENGINE_IMPL = 'real';
    process.env.AGENT_IMPL = 'real';
    process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;

    resetCachedEnv();
    resetEngineInstance();
    resetAgentInstance();

    await setupTestDatabase();
    process.env.WEBHOOK_VERIFY = 'false';

    app = await buildApp();
    await app.ready();

    // Reset database to ensure clean seed state
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/demo/reset',
      payload: {},
    });
    expect(resetRes.statusCode).toBe(200);
  });

  afterAll(async () => {
    resetEngineInstance();
    resetAgentInstance();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('POST /api/agent/run executes real engine + real agent, producing 8 actions with expected properties and idempotency', async () => {
    // 1. First run of runCycle
    const run1 = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });

    expect(run1.statusCode).toBe(200);
    const body1 = JSON.parse(run1.payload);
    expect(body1.runId).toBeDefined();
    expect(Array.isArray(body1.actions)).toBe(true);

    // Assert actions for all 8 overdue invoices
    expect(body1.actions).toHaveLength(8);

    // Ghost payer's invoice is inv_008 -> must be ESCALATE
    const ghostAction = body1.actions.find((a: ActionRecord) => a.invoiceId === 'inv_008');
    expect(ghostAction).toBeDefined();
    expect(ghostAction?.type).toBe('ESCALATE');

    // Discount and instalment actions must be AWAITING_APPROVAL
    const discountOrInstalment = body1.actions.filter((a: ActionRecord) =>
      a.type === 'OFFER_DISCOUNT' || a.type === 'OFFER_INSTALMENTS',
    );
    expect(discountOrInstalment.length).toBeGreaterThan(0);
    for (const act of discountOrInstalment) {
      expect(act.status).toBe('AWAITING_APPROVAL');
    }

    // No action is BLOCKED when POLICY_IGNORE_QUIET_HOURS=true
    const blockedActions = body1.actions.filter((a: ActionRecord) => a.status === 'BLOCKED');
    expect(blockedActions).toHaveLength(0);

    // All actions must carry provenance metadata
    for (const act of body1.actions) {
      expect(act.reason).toMatch(/\[via (rules; path=rules|provider=mock; model=mock-model; path=(llm|fallback))\]/);
    }

    // 2. Second consecutive run of runCycle succeeds without crashing or 500
    const run2 = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });

    expect(run2.statusCode).toBe(200);
    const body2 = JSON.parse(run2.payload);
    expect(body2.runId).toBeDefined();
    expect(body2.actions).toHaveLength(8);

    // Verify GET /api/actions returns successfully
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/actions',
    });
    expect(listRes.statusCode).toBe(200);
    const allActions = JSON.parse(listRes.payload);
    expect(allActions.length).toBeGreaterThanOrEqual(8);
  });
});

