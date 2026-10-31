import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { Snapshot } from '@settle/shared';
import { getEnv } from './config/env.js';
import {
  BusinessRepository,
  PayerRepository,
  InvoiceRepository,
  ObligationRepository,
  PolicyRepository,
  ActionRecordRepository,
  AuditEventRepository,
  InvoicePayPalIdRepository,
} from './db/repositories.js';
import { runMigrations } from './db/migrate.js';
import { resetDemoData } from './db/seed.js';
import { getEngine } from './adapters/engine.js';
import { getAgent } from './adapters/agent.js';
import { eventBus } from './events/bus.js';
import { PayPalClient } from './paypal/client.js';
import { PayPalWebhookHandler } from './paypal/webhook.js';
import {
  SimulateRequestBodySchema,
  ChatRequestBodySchema,
  PolicySchema,
  DashboardResponseSchema,
  ActionDecisionBodySchema,
} from './schemas/index.js';

export interface BuildAppOptions {
  paypalClient?: PayPalClient;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      // allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return cb(null, true);
      if (origin === env.WEB_ORIGIN || origin.startsWith('http://localhost:')) {
        return cb(null, true);
      }
      return cb(null, true);
    },
    credentials: true,
  });

  // Global Error Handler formatting: { error: { code, message, details? } }
  app.setErrorHandler((error: any, request, reply) => {
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = error?.message || 'An unexpected error occurred';
    let details: unknown = undefined;

    if (error instanceof z.ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.errors;
    } else if (error?.statusCode) {
      statusCode = error.statusCode;
      code = error.code || 'HTTP_ERROR';
    }

    reply.status(statusCode).send({
      error: {
        code,
        message,
        details,
      },
    });
  });

  // 404 Handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Repositories
  const businessRepo = new BusinessRepository();
  const payerRepo = new PayerRepository();
  const invoiceRepo = new InvoiceRepository();
  const obligationRepo = new ObligationRepository();
  const policyRepo = new PolicyRepository();
  const actionRepo = new ActionRecordRepository();
  const auditRepo = new AuditEventRepository();
  const historyRepo = new InvoicePayPalIdRepository();

  // PayPal client and webhook handler
  const paypalClient =
    options.paypalClient ??
    new PayPalClient({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      baseUrl: env.PAYPAL_BASE_URL,
      historyRepo,
    });

  const webhookHandler = new PayPalWebhookHandler(paypalClient, app.log);

  // Helper to construct current snapshot from DB
  async function getCurrentSnapshot(): Promise<Snapshot> {
    let business = await businessRepo.get();
    if (!business) {
      await resetDemoData();
      business = (await businessRepo.get())!;
    }
    const payers = await payerRepo.list();
    const invoices = await invoiceRepo.list();
    const obligations = await obligationRepo.list();
    const policy = await policyRepo.get();

    return {
      business,
      payers,
      invoices,
      obligations,
      policy,
    };
  }

  // ── Routes ──────────────────────────────────────────────────────────────

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // 1. Dashboard
  app.get('/api/dashboard', async (request, reply) => {
    const snapshot = await getCurrentSnapshot();
    const engine = await getEngine();

    const receipts = engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const forecast = engine.forecast({
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    });
    const kpis = engine.kpis(snapshot);

    const overdueInvoices = snapshot.invoices.filter(
      (inv) =>
        inv.dueDate < snapshot.business.asOf &&
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'REFUNDED',
    );

    const recentActions = await actionRepo.list();
    const auditLog = await auditRepo.list(50);

    const dashboardData = {
      business: snapshot.business,
      kpis,
      forecast,
      overdueInvoices,
      obligations: snapshot.obligations,
      recentActions: recentActions.slice(0, 10),
      auditLog,
    };

    // Validate response shape against Contract v1 schema
    const validated = DashboardResponseSchema.parse(dashboardData);
    return validated;
  });

  // 2. Invoices list
  app.get('/api/invoices', async () => {
    return invoiceRepo.list();
  });

  // 3. Agent Run Cycle
  app.post('/api/agent/run', async (request, reply) => {
    const snapshot = await getCurrentSnapshot();
    const agent = await getAgent();
    const result = await agent.runCycle(snapshot);

    // Save proposed actions
    for (const action of result.actions) {
      const existing = await actionRepo.getById(action.id);
      if (!existing) {
        await actionRepo.insert(action);
        eventBus.emitEvent({ type: 'action.updated', payload: action });
      }
    }

    return result;
  });

  // 4. Actions list
  app.get('/api/actions', async () => {
    return actionRepo.list();
  });

  // 5. Action Approve
  app.post<{ Params: { id: string } }>('/api/actions/:id/approve', async (request, reply) => {
    const { id } = request.params;
    const body = ActionDecisionBodySchema.parse(request.body || {});

    const record = await actionRepo.getById(id);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `ActionRecord ${id} not found` },
      });
    }

    const updated = await actionRepo.update(id, {
      status: 'APPROVED',
      decidedBy: 'owner',
      executedAt: new Date().toISOString(),
    });

    const auditEvt = {
      id: `aud_appr_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'owner' as const,
      kind: 'action.approved',
      summary: `Action ${record.type} for invoice ${record.invoiceId} approved by owner.`,
      actionId: id,
      invoiceId: record.invoiceId,
      detail: body,
    };
    await auditRepo.append(auditEvt);

    eventBus.emitEvent({ type: 'action.updated', payload: updated });
    eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });

    return updated;
  });

  // 6. Action Reject
  app.post<{ Params: { id: string } }>('/api/actions/:id/reject', async (request, reply) => {
    const { id } = request.params;
    const body = ActionDecisionBodySchema.parse(request.body || {});

    const record = await actionRepo.getById(id);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `ActionRecord ${id} not found` },
      });
    }

    const updated = await actionRepo.update(id, {
      status: 'REJECTED',
      decidedBy: 'owner',
    });

    const auditEvt = {
      id: `aud_rej_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'owner' as const,
      kind: 'action.rejected',
      summary: `Action ${record.type} for invoice ${record.invoiceId} rejected by owner.`,
      actionId: id,
      invoiceId: record.invoiceId,
      detail: body,
    };
    await auditRepo.append(auditEvt);

    eventBus.emitEvent({ type: 'action.updated', payload: updated });
    eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });

    return updated;
  });

  // 7. Simulate Scenario
  app.post('/api/simulate', async (request, reply) => {
    const body = SimulateRequestBodySchema.parse(request.body);
    const snapshot = await getCurrentSnapshot();
    const engine = await getEngine();

    const receipts = engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const comparison = engine.simulate(
      {
        business: snapshot.business,
        obligations: snapshot.obligations,
        receipts,
        horizonDays: 30,
      },
      body.change,
    );

    return comparison;
  });

  // 8. Chat
  app.post('/api/chat', async (request, reply) => {
    const body = ChatRequestBodySchema.parse(request.body);
    const snapshot = await getCurrentSnapshot();
    const agent = await getAgent();

    const answer = await agent.chat(body.question, snapshot);
    return answer;
  });

  // 9. Audit Events
  app.get('/api/audit', async () => {
    return auditRepo.list(100);
  });

  // 10. Policy Get & Put
  app.get('/api/policy', async () => {
    return policyRepo.get();
  });

  app.put('/api/policy', async (request, reply) => {
    const body = PolicySchema.parse(request.body);
    const updated = await policyRepo.update(body);

    const auditEvt = {
      id: `aud_pol_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'owner' as const,
      kind: 'policy.updated',
      summary: 'Collection policy configuration updated.',
      detail: body,
    };
    await auditRepo.append(auditEvt);
    eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });

    return updated;
  });

  // 11. SSE Hub
  app.get('/api/events', (request, reply) => {
    eventBus.handleSseConnection(request, reply);
  });

  // 12. PayPal Webhook
  app.post('/api/webhooks/paypal', async (request, reply) => {
    const headers = request.headers as any;
    const body = request.body;

    const isValid = await webhookHandler.verifySignature(headers, body);
    if (!isValid) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'PayPal webhook signature verification failed',
        },
      });
    }

    // Process safely and quickly return 200
    try {
      const result = await webhookHandler.processEvent(body);
      return reply.status(200).send({
        status: 'ok',
        handled: result.handled,
        duplicate: result.duplicate,
      });
    } catch (err) {
      request.log.error({ err }, 'Error processing PayPal webhook');
      // Return 200 to acknowledge or 500 for PayPal retry
      return reply.status(500).send({
        error: {
          code: 'WEBHOOK_PROCESSING_FAILED',
          message: 'Internal error processing webhook',
        },
      });
    }
  });

  // 13. Demo Reset
  app.post('/api/demo/reset', async (request, reply) => {
    await resetDemoData();

    // Recompute forecast & broadcast updated event
    const snapshot = await getCurrentSnapshot();
    const engine = await getEngine();
    const receipts = engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const forecast = engine.forecast({
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    });

    eventBus.emitEvent({ type: 'forecast.updated', payload: forecast });

    return {
      status: 'ok',
      message: 'Demo dataset restored to Contract v1 seed scenario',
      business: snapshot.business.name,
      asOf: snapshot.business.asOf,
      invoicesCount: snapshot.invoices.length,
    };
  });

  return app;
}
