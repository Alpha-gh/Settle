import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  type Snapshot,
  type Payer,
  type AuditEvent,
  type Policy,
  type ActionRecord,
  type PayPalPort,
  type AgentRunResult,
  evaluatePolicy,
} from '@settle/shared';
import { getEnv, findRepoRoot } from './config/env.js';
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
import { getRawSql } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { resetDemoData } from './db/seed.js';
import { getEngine } from './adapters/engine.js';
import { getAgent } from './adapters/agent.js';
import { StubAgent } from './adapters/stubs.js';
import { eventBus } from './events/bus.js';
import { PayPalClient } from './paypal/client.js';
import { PayPalWebhookHandler } from './paypal/webhook.js';
import { ActionService, NotProvisionedError } from './services/actions.js';
import { PaymentReconciliationService } from './services/reconciliation.js';
import {
  SimulateRequestBodySchema,
  ChatRequestBodySchema,
  PolicySchema,
  DashboardResponseSchema,
  ActionDecisionBodySchema,
  AgentRunRequestBodySchema,
  SimulatePaymentBodySchema,
} from './schemas/index.js';

export interface BuildAppOptions {
  paypalClient?: PayPalClient | PayPalPort;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    bodyLimit: 1048576, // 1MB body limit (Item 4)
    connectionTimeout: 120000, // 120s timeout (never shorter than 60s)
    requestTimeout: 120000, // 120s timeout (never shorter than 60s)
    keepAliveTimeout: 65000, // 65s keepalive for upstream proxies
    logger: {
      level: env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // Security Headers (Item 4)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Rate Limiting (Item 4: POST routes 60/min, generous on /api/demo/*)
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    allowList: (req) => {
      if (req.method !== 'POST') return true;
      if (req.url.startsWith('/api/demo')) return true;
      if (env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'true') {
        return true;
      }
      return false;
    },
    errorResponseBuilder: (_req, context) => {
      const err: any = new Error(`Rate limit exceeded, retry in ${context.after}`);
      err.statusCode = 429;
      err.code = 'RATE_LIMIT_EXCEEDED';
      return err;
    },
  });

  // CORS (Item 4)
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === env.WEB_ORIGIN) return cb(null, true);
      if (env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Global Error Handler (Item 4: mask 500 stack traces in production)
  app.setErrorHandler((error: any, request, reply) => {
    if (error?.statusCode === 429 || error?.code === 'RATE_LIMIT_EXCEEDED' || error?.code === 'FST_ERR_RATE_LIMIT_EXCEEDED') {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: error.message || 'Rate limit exceeded, retry later',
        },
      });
    }

    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = error?.message || 'An unexpected error occurred';
    let details: unknown = undefined;

    if (error instanceof z.ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.errors;
    } else if (error instanceof NotProvisionedError || error?.statusCode === 409 || error?.code === 'NOT_PROVISIONED') {
      statusCode = 409;
      code = 'NOT_PROVISIONED';
      message = error.message || 'Invoice is not provisioned in PayPal';
    } else if (error?.statusCode && error.statusCode < 500) {
      statusCode = error.statusCode;
      code = error.code || 'HTTP_ERROR';
      message = error.message;
      details = error.details;
    } else {
      statusCode = error?.statusCode || 500;
      code = 'INTERNAL_ERROR';
      if (env.NODE_ENV === 'production') {
        message = 'Internal server error';
        details = undefined;
      } else {
        message = error?.message || 'An unexpected error occurred';
        details = error?.stack;
      }
    }

    reply.status(statusCode).send({
      error: {
        code,
        message,
        details,
      },
    });
  });

  // Static Hosting & SPA Fallback (Item 3)
  const candidateWebPaths = [
    resolve(findRepoRoot(), 'apps/web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
    resolve(process.cwd(), '../../apps/web/dist'),
  ];
  const webDistPath = candidateWebPaths.find((p) => existsSync(p) && existsSync(resolve(p, 'index.html')));

  if (webDistPath) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });
  }

  // Root landing page (serve SPA index if available, otherwise friendly HTML landing page)
  app.get('/', async (request, reply) => {
    if (webDistPath && existsSync(resolve(webDistPath, 'index.html'))) {
      return reply.sendFile('index.html');
    }
    return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settle Core API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); max-width: 480px; width: 100%; text-align: center; border: 1px solid #334155; }
    h1 { margin-top: 0; color: #38bdf8; font-size: 1.8rem; }
    p { color: #94a3b8; line-height: 1.6; }
    .links { margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center; }
    a { display: inline-block; padding: 0.6rem 1.2rem; background: #0284c7; color: white; text-decoration: none; border-radius: 0.5rem; font-weight: 500; transition: background 0.2s; }
    a:hover { background: #0369a1; }
    .badge { display: inline-block; background: #10b981; color: #022c22; font-size: 0.8rem; font-weight: bold; padding: 0.2rem 0.6rem; border-radius: 9999px; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">API ACTIVE</span>
    <h1>Settle Core API</h1>
    <p>The autonomous cashflow recovery platform API is up and running.</p>
    <div class="links">
      <a href="/health">Health Check</a>
      <a href="/api/dashboard">Dashboard API</a>
    </div>
  </div>
</body>
</html>`);
  });

  // 404 Handler with SPA fallback
  app.setNotFoundHandler((request, reply) => {
    if (webDistPath && request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/health')) {
      return reply.sendFile('index.html');
    }
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
      useNumberSuffix: env.PAYPAL_NUMBER_SUFFIX,
      historyRepo,
    });

  const reconcileService = new PaymentReconciliationService(paypalClient);

  const actionService = new ActionService(
    actionRepo,
    invoiceRepo,
    payerRepo,
    policyRepo,
    auditRepo,
    historyRepo,
    paypalClient,
  );

  const webhookHandler = new PayPalWebhookHandler(paypalClient as any, app.log, reconcileService);

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

  // Health check with Postgres connectivity check (Item 4)
  app.get('/health', async (request, reply) => {
    try {
      const sql = getRawSql();
      await sql`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch (err: any) {
      app.log.error({ err }, 'Health check database query failed');
      return reply.status(503).send({
        status: 'error',
        database: 'disconnected',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database unavailable',
        },
      });
    }
  });

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

    const recentActions = await actionRepo.list();
    const auditLog = await auditRepo.list(50);

    const dashboardData = {
      business: snapshot.business,
      kpis,
      forecast,
      invoices: snapshot.invoices,
      payers: snapshot.payers,
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
    const body = AgentRunRequestBodySchema?.parse(request.body || {});
    const targetInvoiceId = body?.invoiceId;

    if (targetInvoiceId) {
      const inv = await invoiceRepo.getById(targetInvoiceId);
      if (!inv) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Invoice ${targetInvoiceId} not found` },
        });
      }
      if (!inv.paypalInvoiceId) {
        return reply.status(409).send({
          error: { code: 'NOT_PROVISIONED', message: 'Invoice is not provisioned in PayPal' },
        });
      }
    }

    const snapshot = await getCurrentSnapshot();
    let result: AgentRunResult;

    try {
      const agent = await getAgent();
      result = await agent.runCycle(snapshot);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Agent runCycle failed');

      const errorAudit: AuditEvent = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        actor: 'system',
        kind: 'agent.error',
        summary: `Agent runCycle failed: ${errorMessage}`,
        detail: { error: errorMessage, context: 'runCycle' },
      };
      await auditRepo.append(errorAudit);
      eventBus.emitEvent({ type: 'audit.appended', payload: errorAudit });

      const currentEnv = getEnv();
      if (currentEnv.AGENT_FALLBACK_TO_STUB) {
        request.log.warn('AGENT_FALLBACK_TO_STUB=true: falling back to StubAgent for runCycle');
        const stubAgent = new StubAgent();
        result = await stubAgent.runCycle(snapshot);
      } else {
        return reply.status(502).send({
          error: {
            code: 'AGENT_FAILED',
            message: `Agent execution failed: ${errorMessage}`,
          },
        });
      }
    }

    if (targetInvoiceId) {
      result.actions = result.actions.filter((a) => a.invoiceId === targetInvoiceId);
      result.skipped = result.skipped.filter((s) => s.invoiceId === targetInvoiceId);
    }

    const now = new Date();
    const effectivePolicy: Policy = env.POLICY_IGNORE_QUIET_HOURS
      ? { ...snapshot.policy, quietHours: { startHour: 0, endHour: 0 } }
      : snapshot.policy;

    const processedActions: ActionRecord[] = [];

    for (const action of result.actions) {
      const invoice = snapshot.invoices.find((i) => i.id === action.invoiceId);
      if (!invoice) {
        continue;
      }

      // Re-evaluate policy server-side
      const remindersLastWeek = await actionService.countRemindersLastWeek(invoice.id, now);
      const serverVerdict = evaluatePolicy(
        { type: action.type, params: action.params },
        invoice,
        effectivePolicy,
        { now, remindersLastWeek },
      );

      // Audit discrepancy if server verdict differs from agent's verdict
      if (
        serverVerdict.allowed !== action.policy.allowed ||
        serverVerdict.requiresApproval !== action.policy.requiresApproval
      ) {
        const discAudit: AuditEvent = {
          id: randomUUID(),
          ts: now.toISOString(),
          actor: 'system',
          kind: 'policy.discrepancy',
          summary: `Policy discrepancy detected for action ${action.id}: server verdict differed from agent proposed verdict`,
          invoiceId: invoice.id,
          actionId: action.id,
          detail: { agentPolicy: action.policy, serverVerdict },
        };
        await auditRepo.append(discAudit);
        eventBus.emitEvent({ type: 'audit.appended', payload: discAudit });
      }

      action.policy = serverVerdict;

      if (!serverVerdict.allowed) {
        action.status = 'BLOCKED';
      } else if (serverVerdict.requiresApproval) {
        action.status = 'AWAITING_APPROVAL';
      } else {
        action.status = 'APPROVED';
        action.decidedBy = 'auto';
      }

      const existing = await actionRepo.getById(action.id);
      if (existing) {
        await actionRepo.update(action);
      } else {
        await actionRepo.insert(action);
      }
      eventBus.emitEvent({ type: 'action.updated', payload: action });

      // Auto-execute allowed-without-approval actions
      if (action.status === 'APPROVED' && action.decidedBy === 'auto') {
        const requiresPayPal = ['REMIND', 'OFFER_DISCOUNT', 'OFFER_INSTALMENTS'].includes(action.type);
        if (requiresPayPal && !invoice.paypalInvoiceId) {
          action.status = 'AWAITING_APPROVAL';
          action.decidedBy = undefined;
          await actionRepo.update(action);
          processedActions.push(action);
        } else {
          const executed = await actionService.executeAction(action.id, 'auto');
          processedActions.push(executed);
        }
      } else {
        processedActions.push(action);
      }
    }

    result.actions = processedActions;
    return result;
  });

  // 4. Actions list
  app.get('/api/actions', async () => {
    return actionRepo.list();
  });

  // 5. Action Approve
  app.post<{ Params: { id: string } }>('/api/actions/:id/approve', async (request, reply) => {
    const { id } = request.params;
    ActionDecisionBodySchema.parse(request.body || {});

    const record = await actionRepo.getById(id);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `ActionRecord ${id} not found` },
      });
    }

    const executed = await actionService.executeAction(id, 'owner');
    return executed;
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

    const rejected = await actionService.rejectAction(id, body.note);
    return rejected;
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

    try {
      const agent = await getAgent();
      const answer = await agent.chat(body.question, snapshot);
      return answer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, 'Agent chat failed');

      const errorAudit: AuditEvent = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        actor: 'system',
        kind: 'agent.error',
        summary: `Agent chat failed: ${errorMessage}`,
        detail: { error: errorMessage, context: 'chat', question: body.question },
      };
      await auditRepo.append(errorAudit);
      eventBus.emitEvent({ type: 'audit.appended', payload: errorAudit });

      const currentEnv = getEnv();
      if (currentEnv.AGENT_FALLBACK_TO_STUB) {
        request.log.warn('AGENT_FALLBACK_TO_STUB=true: falling back to StubAgent for chat');
        const stubAgent = new StubAgent();
        return stubAgent.chat(body.question, snapshot);
      } else {
        return reply.status(502).send({
          error: {
            code: 'AGENT_FAILED',
            message: `Agent execution failed: ${errorMessage}`,
          },
        });
      }
    }
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

  // Helper to provision PayPal invoices for SENT invoices missing paypalInvoiceId
  async function provisionPayPal(): Promise<{
    provisioned: number;
    skipped: number;
    failed: number;
    failures: Array<{ invoiceId: string; error: string }>;
  }> {
    const allInvoices = await invoiceRepo.list();
    const allPayers = await payerRepo.list();
    const payerMap = new Map(allPayers.map((p) => [p.id, p]));

    const demoBuyerInvoiceIds = env.DEMO_BUYER_INVOICE_IDS
      ? env.DEMO_BUYER_INVOICE_IDS.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;
    const failures: Array<{ invoiceId: string; error: string }> = [];

    for (const inv of allInvoices) {
      if (inv.status !== 'SENT' || inv.paypalInvoiceId) {
        skipped++;
        continue;
      }

      const payer = payerMap.get(inv.payerId);
      if (!payer) {
        failed++;
        failures.push({ invoiceId: inv.id, error: `Payer ${inv.payerId} not found` });
        continue;
      }

      const effectivePayer: Payer =
        demoBuyerInvoiceIds.includes(inv.id) && env.PAYPAL_BUYER_EMAIL
          ? { ...payer, email: env.PAYPAL_BUYER_EMAIL }
          : payer;

      try {
        const res = await paypalClient.createAndSendInvoice(inv, effectivePayer);
        const updatedInv = await invoiceRepo.update(inv.id, {
          paypalInvoiceId: res.paypalInvoiceId,
          payUrl: res.payUrl,
        });

        const paypalInvoiceNumber = (res as any).paypalInvoiceNumber;
        await historyRepo.record(inv.id, res.paypalInvoiceId, 'initial_provisioning', paypalInvoiceNumber);

        const auditTrail = typeof (paypalClient as any).getAuditTrail === 'function'
          ? (paypalClient as any).getAuditTrail()
          : [];
        const lastAudit = auditTrail[auditTrail.length - 1];

        const provAudit: AuditEvent = {
          id: randomUUID(),
          ts: new Date().toISOString(),
          actor: 'paypal',
          kind: 'invoice.provisioned',
          summary: `Invoice ${inv.number} provisioned in PayPal as ${res.paypalInvoiceId}${paypalInvoiceNumber ? ` (${paypalInvoiceNumber})` : ''}`,
          invoiceId: inv.id,
          paypalRequestId: lastAudit?.paypalRequestId,
          detail: {
            paypalInvoiceId: res.paypalInvoiceId,
            paypalInvoiceNumber,
            payUrl: res.payUrl,
            recipientEmail: effectivePayer.email,
          },
        };
        await auditRepo.append(provAudit);
        eventBus.emitEvent({ type: 'audit.appended', payload: provAudit });

        if (updatedInv) {
          eventBus.emitEvent({ type: 'invoice.updated', payload: updatedInv });
        }

        provisioned++;
        // Short delay between sequential provisioning requests
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err: any) {
        failed++;
        const failureItem: any = {
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          error: err?.message || String(err),
        };
        if (err?.name === 'PayPalError' || err?.paypalName || err?.debug_id || err?.debugId) {
          failureItem.name = err.paypalName || err.name;
          failureItem.debug_id = err.debug_id || err.debugId;
          failureItem.issues = err.issues;
          failureItem.details = err.details;
        }
        app.log.error({
          msg: `Failed to provision PayPal invoice for ${inv.number}`,
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          error: failureItem.error,
          paypalName: failureItem.name,
          debug_id: failureItem.debug_id,
          issues: failureItem.issues,
          details: failureItem.details,
        });
        failures.push(failureItem);
      }
    }

    return { provisioned, skipped, failed, failures };
  }

  // 13. Demo Provision PayPal
  app.post('/api/demo/provision-paypal', async () => {
    return provisionPayPal();
  });

  // 14. Demo Simulate Payment
  app.post('/api/demo/simulate-payment', async (request, reply) => {
    const body = SimulatePaymentBodySchema.parse(request.body);
    const invoice = await invoiceRepo.getById(body.invoiceId);
    if (!invoice) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Invoice ${body.invoiceId} not found` },
      });
    }

    if (!invoice.paypalInvoiceId) {
      return reply.status(409).send({
        error: { code: 'NOT_PROVISIONED', message: 'Invoice is not provisioned in PayPal' },
      });
    }

    const remaining = invoice.amount - invoice.amountPaid;
    const paymentAmount = body.amount ?? remaining;
    if (paymentAmount <= 0) {
      return reply.status(400).send({
        error: { code: 'INVALID_AMOUNT', message: 'Payment amount must be greater than 0' },
      });
    }

    let paymentResult: any = { paymentId: `ext_pay_${randomUUID().slice(0, 8)}`, paypalRequestId: randomUUID() };
    if (typeof (paypalClient as any).recordExternalPayment === 'function') {
      paymentResult = await (paypalClient as any).recordExternalPayment(
        invoice.paypalInvoiceId,
        paymentAmount,
        'Simulated payment via Settle demo',
      );
    }

    // Immediately reconcile via single shared reconciliation path
    const result = await reconcileService.reconcileInvoicePayment({
      invoiceId: invoice.id,
      paypalInvoiceId: invoice.paypalInvoiceId,
      actor: 'paypal',
      eventType: 'invoice.paid',
      paypalRequestId: paymentResult?.paypalRequestId,
      extraDetail: {
        paymentAmount,
        paymentId: paymentResult?.paymentId,
        simulated: true,
      },
    });

    return {
      status: 'ok',
      invoice: result.invoice,
      forecast: result.forecast,
      delta: result.delta,
      newCashBalance: result.newBalance,
    };
  });

  // 15. Demo Reset
  app.post('/api/demo/reset', async (request, reply) => {
    await resetDemoData();
    let provisioningResult;
    if (env.AUTO_PROVISION_PAYPAL) {
      provisioningResult = await provisionPayPal();
    }

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
      provisioning: provisioningResult,
    };
  });

  return app;
}
