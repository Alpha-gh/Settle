import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ActionRecord, AuditEvent } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import { resetCachedEnv } from '../src/config/env.js';
import { resetAgentInstance, setAgentInstance, resetAgentRunLock } from '../src/adapters/agent.js';
import { resetEngineInstance } from '../src/adapters/engine.js';
import { ActionRecordRepository, AuditEventRepository, PolicyRepository } from '../src/db/repositories.js';

describe('Agent Action Superseding, Closed Action Guard, and Run Lock (Item 4)', () => {
  let app: FastifyInstance;
  const actionRepo = new ActionRecordRepository();
  const auditRepo = new AuditEventRepository();

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
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('run twice leaves exactly one open action per overdue invoice with older actions superseded', async () => {
    // 1. Reset database to baseline
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/demo/reset',
      payload: {},
    });
    expect(resetRes.statusCode).toBe(200);

    // Set autoApproveMaxAmount to 0 so all generated actions require approval and remain open
    const policyRepo = new PolicyRepository();
    const policy = await policyRepo.get();
    await policyRepo.update({ ...policy, autoApproveMaxAmount: 0 });

    // 2. First agent run
    const run1 = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });
    expect(run1.statusCode).toBe(200);
    const body1 = JSON.parse(run1.payload);
    expect(body1.actions).toHaveLength(8);
    const run1ActionIds = new Set(body1.actions.map((a: ActionRecord) => a.id));

    // 3. Second agent run
    const run2 = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: {},
    });
    expect(run2.statusCode).toBe(200);
    const body2 = JSON.parse(run2.payload);
    expect(body2.actions).toHaveLength(8);
    const run2ActionIds = new Set(body2.actions.map((a: ActionRecord) => a.id));

    // 4. Verify GET /api/actions?open=true returns exactly 8 open actions
    const openRes = await app.inject({
      method: 'GET',
      url: '/api/actions?open=true',
    });
    expect(openRes.statusCode).toBe(200);
    const openActions: ActionRecord[] = JSON.parse(openRes.payload);
    expect(openActions).toHaveLength(8);

    // Exactly one open action per overdue invoice
    const openInvoiceIds = openActions.map((a) => a.invoiceId);
    expect(new Set(openInvoiceIds).size).toBe(8);

    // Every open action belongs to the second run
    for (const openAct of openActions) {
      expect(run2ActionIds.has(openAct.id)).toBe(true);
      expect(['PROPOSED', 'AWAITING_APPROVAL', 'BLOCKED', 'APPROVED']).toContain(openAct.status);
    }

    // 5. Verify all actions list contains both runs (16 actions)
    const allRes = await app.inject({
      method: 'GET',
      url: '/api/actions',
    });
    expect(allRes.statusCode).toBe(200);
    const allActions: ActionRecord[] = JSON.parse(allRes.payload);
    expect(allActions.length).toBeGreaterThanOrEqual(16);

    // 6. Verify run 1 actions are marked REJECTED with suffix and decidedBy "auto"
    for (const actId of run1ActionIds) {
      const oldAct = allActions.find((a) => a.id === actId);
      expect(oldAct).toBeDefined();
      expect(oldAct?.status).toBe('REJECTED');
      expect(oldAct?.decidedBy).toBe('auto');
      expect(oldAct?.reason).toContain('Superseded by a newer agent run');
    }

    // 7. Verify action.superseded audit events exist
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
    });
    expect(auditRes.statusCode).toBe(200);
    const audits: AuditEvent[] = JSON.parse(auditRes.payload);
    const supersededAudits = audits.filter((a) => a.kind === 'action.superseded');
    expect(supersededAudits.length).toBeGreaterThanOrEqual(8);
  });

  it('approve on a superseded action returns 409 ACTION_NOT_OPEN and never executes anything', async () => {
    // Find a superseded action from the previous test
    const allActions = await actionRepo.list();
    const superseded = allActions.find(
      (a) => a.status === 'REJECTED' && a.reason.includes('Superseded by a newer agent run'),
    );
    expect(superseded).toBeDefined();

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${superseded!.id}/approve`,
      payload: { note: 'Attempting to approve superseded action' },
    });

    expect(approveRes.statusCode).toBe(409);
    const errBody = JSON.parse(approveRes.payload);
    expect(errBody.error).toBeDefined();
    expect(errBody.error.code).toBe('ACTION_NOT_OPEN');

    // Confirm DB record remained REJECTED and was not executed
    const checkRecord = await actionRepo.getById(superseded!.id);
    expect(checkRecord?.status).toBe('REJECTED');
    expect(checkRecord?.executedAt).toBeUndefined();
  });

  it('concurrent agent runs return 409 AGENT_RUN_IN_PROGRESS', async () => {
    // Use an agent that sleeps for 250ms during runCycle to reliably trigger overlap
    const slowAgent = {
      async runCycle(snapshot: any) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const realAgentModule = await import('../src/adapters/agent.js');
        const stub = new (await import('../src/adapters/stubs.js')).StubAgent();
        return stub.runCycle(snapshot);
      },
      async chat(q: string, s: any) {
        const stub = new (await import('../src/adapters/stubs.js')).StubAgent();
        return stub.chat(q, s);
      },
    };

    setAgentInstance(slowAgent as any);

    try {
      // Fire two concurrent POST /api/agent/run requests
      const [res1, res2] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/agent/run', payload: {} }),
        new Promise<any>((resolve) => {
          // slight delay so first request acquires the lock first
          setTimeout(async () => {
            const r = await app.inject({ method: 'POST', url: '/api/agent/run', payload: {} });
            resolve(r);
          }, 30);
        }),
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode].sort();
      expect(statusCodes).toEqual([200, 409]);

      const rejectedRes = res1.statusCode === 409 ? res1 : res2;
      const rejectedBody = JSON.parse(rejectedRes.payload);
      expect(rejectedBody.error.code).toBe('AGENT_RUN_IN_PROGRESS');
    } finally {
      resetAgentInstance();
      resetAgentRunLock();
    }
  });

  it('actions returned by GET /api/actions and agent run include reasonDisplay and reasonSource without changing stored reason', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/actions?open=true',
    });
    expect(res.statusCode).toBe(200);
    const actions = JSON.parse(res.payload);
    expect(actions.length).toBeGreaterThan(0);

    for (const act of actions) {
      expect(act.reason).toBeDefined();
      expect(act.reasonDisplay).toBeDefined();
      // reasonDisplay must not contain the [via ...] tag
      expect(act.reasonDisplay).not.toMatch(/\[via [^\]]+\]/);

      if (act.reasonSource) {
        expect(act.reasonSource).toMatch(/\[via [^\]]+\]/);
        // The original reason should contain the source tag
        expect(act.reason).toContain(act.reasonSource);
      }
    }
  });
});
