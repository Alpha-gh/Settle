import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentPort, AgentRunResult, ChatAnswer, Snapshot } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import { AuditEventRepository } from '../src/db/repositories.js';
import { setAgentInstance, resetAgentInstance } from '../src/adapters/agent.js';
import { resetCachedEnv } from '../src/config/env.js';

class FailingAgent implements AgentPort {
  async runCycle(_snapshot: Snapshot): Promise<AgentRunResult> {
    throw new Error('Simulated LLM quota exceeded (429)');
  }

  async chat(_question: string, _snapshot: Snapshot): Promise<ChatAnswer> {
    throw new Error('Simulated upstream model timeout (504)');
  }
}

describe('Agent Safety, Error Resilience & Fallback (Item 6)', () => {
  let app: FastifyInstance;
  const auditRepo = new AuditEventRepository();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await setupTestDatabase();
    process.env.WEBHOOK_VERIFY = 'false';

    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    resetAgentInstance();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('runCycle failure with AGENT_FALLBACK_TO_STUB=true falls back to StubAgent and logs agent.error audit', async () => {
    process.env.AGENT_FALLBACK_TO_STUB = 'true';
    resetCachedEnv();
    setAgentInstance(new FailingAgent());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.actions).toBeDefined();
      expect(body.actions.length).toBeGreaterThan(0);

      // Verify agent.error audit event was logged
      const audits = await auditRepo.list(50);
      const errorAudit = audits.find((a) => a.kind === 'agent.error' && a.summary.includes('quota exceeded'));
      expect(errorAudit).toBeDefined();
      expect(errorAudit?.kind).toBe('agent.error');
    } finally {
      resetAgentInstance();
    }
  });

  it('runCycle failure with AGENT_FALLBACK_TO_STUB=false returns 502 AGENT_FAILED and logs agent.error audit', async () => {
    process.env.AGENT_FALLBACK_TO_STUB = 'false';
    resetCachedEnv();
    setAgentInstance(new FailingAgent());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
        payload: {},
      });

      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.payload);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('AGENT_FAILED');
      expect(body.error.message).toContain('Simulated LLM quota exceeded (429)');
    } finally {
      resetAgentInstance();
      process.env.AGENT_FALLBACK_TO_STUB = 'true';
      resetCachedEnv();
    }
  });

  it('chat failure with AGENT_FALLBACK_TO_STUB=true falls back to StubAgent and logs agent.error audit', async () => {
    process.env.AGENT_FALLBACK_TO_STUB = 'true';
    resetCachedEnv();
    setAgentInstance(new FailingAgent());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { question: 'Can I cover payroll on Friday?' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.text).toBeDefined();

      const audits = await auditRepo.list(50);
      const errorAudit = audits.find((a) => a.kind === 'agent.error' && a.summary.includes('model timeout'));
      expect(errorAudit).toBeDefined();
    } finally {
      resetAgentInstance();
    }
  });

  it('chat failure with AGENT_FALLBACK_TO_STUB=false returns 502 AGENT_FAILED', async () => {
    process.env.AGENT_FALLBACK_TO_STUB = 'false';
    resetCachedEnv();
    setAgentInstance(new FailingAgent());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { question: 'Can I cover payroll on Friday?' },
      });

      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.payload);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('AGENT_FAILED');
      expect(body.error.message).toContain('Simulated upstream model timeout (504)');
    } finally {
      resetAgentInstance();
      process.env.AGENT_FALLBACK_TO_STUB = 'true';
      resetCachedEnv();
    }
  });
});
