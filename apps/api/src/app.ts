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
import { getRawSql, getDb } from './db/index.js';
import { runMigrations, repairInvalidAuditActors } from './db/migrate.js';
import { resetDemoData } from './db/seed.js';
import { getEngine } from './adapters/engine.js';
import {
  getAgent,
  acquireAgentRunLock,
  releaseAgentRunLock,
  getAgentRunStatus,
  getLastLlmError,
  clearLastLlmError,
  getActiveLlm,
} from './adapters/agent.js';
import { redactSecrets } from './utils/redact.js';
import { StubAgent } from './adapters/stubs.js';
import { eventBus } from './events/bus.js';
import { PayPalClient } from './paypal/client.js';
import { PayPalError } from './paypal/errors.js';
import { PayPalWebhookHandler } from './paypal/webhook.js';
import { ActionService, NotProvisionedError, ActionNotOpenError } from './services/actions.js';
import { enrichActionWithDisplayFields } from './utils/provenance.js';
import { and, eq, inArray } from 'drizzle-orm';
import { actionRecords, auditEvents } from './db/schema.js';
import { PaymentReconciliationService } from './services/reconciliation.js';
import {
  SimulateRequestBodySchema,
  ChatRequestBodySchema,
  PolicySchema,
  DashboardResponseSchema,
  ActionDecisionBodySchema,
  AgentRunRequestBodySchema,
  SimulatePaymentBodySchema,
  ReconcileBodySchema,
  InvoiceSchema,
  PayerSchema,
  ObligationSchema,
  ActionRecordSchema,
  AuditEventSchema,
  ResponseValidationError,
  validateResponseSchema,
  filterValidRows,
} from './schemas/index.js';

export interface BuildAppOptions {
  paypalClient?: PayPalClient | PayPalPort;
  loggerStream?: NodeJS.WritableStream;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();

  const loggerConfig: Record<string, unknown> = {
    level: env.NODE_ENV === 'test' ? 'warn' : 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };
  if (options.loggerStream) {
    loggerConfig.stream = options.loggerStream;
  }

  const app = Fastify({
    bodyLimit: 1048576, // 1MB body limit (Item 4)
    connectionTimeout: 120000, // 120s timeout (never shorter than 60s)
    requestTimeout: 120000, // 120s timeout (never shorter than 60s)
    keepAliveTimeout: 65000, // 65s keepalive for upstream proxies
    logger: loggerConfig as any,
  });

  // Security Headers (Item 4)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Rate Limiting (Static assets, /health, /api/events, and all GET routes exempt; POST-only with stricter /api/demo/* cap)
  await app.register(rateLimit, {
    max: (req) => (req.url.startsWith('/api/demo') ? 30 : 60),
    timeWindow: '1 minute',
    keyGenerator: (req) => `${req.ip}:${req.url.startsWith('/api/demo') ? 'demo' : 'post'}`,
    allowList: (req) => {
      if (env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'true') {
        return true;
      }
      if (
        req.method !== 'POST' ||
        req.url.startsWith('/assets/') ||
        req.url === '/health' ||
        req.url.startsWith('/health?') ||
        req.url.startsWith('/api/events')
      ) {
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

  // CORS (Allow same-origin requests, WEB_ORIGIN="*", and comma-separated allowlist without 500 throws)
  await app.register(cors, {
    delegator: (req, cb) => {
      const rawOrigin = req.headers.origin;
      if (!rawOrigin) {
        return cb(null, { origin: true, credentials: true });
      }
      if (env.WEB_ORIGIN === '*') {
        return cb(null, { origin: true, credentials: true });
      }
      const allowedOrigins = env.WEB_ORIGIN.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowedOrigins.includes(rawOrigin)) {
        return cb(null, { origin: true, credentials: true });
      }
      // Always allow same-origin requests (e.g. module scripts/stylesheets with crossorigin attribute)
      const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
      const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
      if (host) {
        try {
          if (new URL(rawOrigin).host === host) {
            return cb(null, { origin: true, credentials: true });
          }
        } catch {
          // Malformed Origin header
        }
      }
      if (env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(rawOrigin)) {
        return cb(null, { origin: true, credentials: true });
      }
      return cb(null, { origin: false });
    },
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
    let alreadyLogged = false;

    if (error instanceof ResponseValidationError) {
      statusCode = 500;
      code = 'INTERNAL_ERROR';
      const formattedIssues = error.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      }));
      request.log.error(
        {
          reqId: request.id,
          route: error.route,
          method: request.method,
          url: request.url,
          issues: formattedIssues,
        },
        `Response validation failed on ${error.route}: ${formattedIssues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      );
      alreadyLogged = true;
      if (env.NODE_ENV === 'production') {
        message = 'Internal server error';
        details = undefined;
      } else {
        message = error.message;
        details = formattedIssues;
      }
    } else if (error instanceof z.ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.errors;
    } else if (error instanceof PayPalError || error?.name === 'PayPalError') {
      const debugId = error.debugId || error.debug_id || (error.rawError as any)?.debug_id;
      request.log.error(
        {
          err: error,
          issues: error.issues,
          debugId,
          paypalStatus: error.status,
        },
        `PayPal API error: ${error.message}`
      );
      return reply.status(502).send({
        error: {
          code: 'PAYPAL_ERROR',
          message: error.message || 'PayPal API error',
          debugId: debugId || undefined,
        },
      });
    } else if (error instanceof ActionNotOpenError || error?.code === 'ACTION_NOT_OPEN') {
      statusCode = 409;
      code = 'ACTION_NOT_OPEN';
      message = error.message || 'Action is not open for approval';
    } else if (error?.code === 'AGENT_RUN_IN_PROGRESS') {
      statusCode = 409;
      code = 'AGENT_RUN_IN_PROGRESS';
      message = error.message || 'An agent run is currently in progress';
    } else if (error instanceof NotProvisionedError || error?.code === 'NOT_PROVISIONED') {
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

    if (statusCode >= 500 && !alreadyLogged) {
      const isStaticReq =
        request.url === '/' ||
        request.url.startsWith('/assets/') ||
        request.url.endsWith('.js') ||
        request.url.endsWith('.css') ||
        request.url.endsWith('.html');
      request.log.error(
        {
          reqId: request.id,
          method: request.method,
          url: request.url,
          origin: request.headers.origin,
          errorMessage: error?.message,
          err: error,
        },
        isStaticReq ? '500 response serving static request' : 'Unhandled 500 error',
      );
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
      index: false,
      etag: true,
      lastModified: true,
      setHeaders: (res, pathName) => {
        if (pathName.endsWith('.html')) {
          res.header('Cache-Control', 'no-cache');
        } else if (pathName.includes('/assets/') || pathName.includes('\\assets\\')) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
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
    if (
      webDistPath &&
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      !request.url.startsWith('/health') &&
      !request.url.startsWith('/assets/')
    ) {
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
    const warnings: string[] = [];
    const rawSnapshot = await getCurrentSnapshot();
    const snapshot: Snapshot = {
      business: rawSnapshot.business,
      payers: filterValidRows(rawSnapshot.payers, PayerSchema, 'payers', request.log, request.id, warnings),
      invoices: filterValidRows(rawSnapshot.invoices, InvoiceSchema, 'invoices', request.log, request.id, warnings),
      obligations: filterValidRows(rawSnapshot.obligations, ObligationSchema, 'obligations', request.log, request.id, warnings),
      policy: rawSnapshot.policy,
    };
    const engine = await getEngine();

    const receipts = engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const forecast = engine.forecast({
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    });
    const kpis = engine.kpis(snapshot);

    const rawRecentActions = await actionRepo.list();
    const rawAuditLog = await auditRepo.list(50);

    const recentActions = filterValidRows(
      rawRecentActions,
      ActionRecordSchema,
      'recentActions',
      request.log,
      request.id,
      warnings,
    );
    const auditLog = filterValidRows(
      rawAuditLog,
      AuditEventSchema,
      'auditLog',
      request.log,
      request.id,
      warnings,
    );

    const dashboardData = {
      business: snapshot.business,
      kpis,
      forecast,
      invoices: snapshot.invoices,
      payers: snapshot.payers,
      obligations: snapshot.obligations,
      recentActions: recentActions.slice(0, 10),
      auditLog,
      warnings,
    };

    // Validate response shape against Contract v1 schema
    const validated = validateResponseSchema(
      DashboardResponseSchema,
      dashboardData,
      'GET /api/dashboard',
    );
    return validated;
  });

  // 2. Invoices list
  app.get('/api/invoices', async () => {
    return invoiceRepo.list();
  });

  // 3. Agent Run Status & Cycle
  app.get('/api/agent/status', async () => {
    return getAgentRunStatus();
  });

  app.post('/api/agent/run', async (request, reply) => {
    const lockResult = acquireAgentRunLock(request.log);
    if (!lockResult.acquired) {
      return reply.status(409).send({
        error: {
          code: 'AGENT_RUN_IN_PROGRESS',
          message: 'An agent run is currently in progress',
          startedAt: lockResult.startedAt,
          ageSeconds: lockResult.ageSeconds,
        },
      });
    }

    try {
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

    clearLastLlmError();
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

    // Check if agent fell back from LLM path (Item 2a)
    const hasFallbackAction = result.actions.some((a) =>
      a.reason.includes('path=fallback'),
    );
    const recordedLlmError = getLastLlmError();

    if (hasFallbackAction || recordedLlmError) {
      const activeLlm = await getActiveLlm().catch(() => null);
      const provider = recordedLlmError?.provider || activeLlm?.info?.provider || 'gemini';
      const model = recordedLlmError?.model || activeLlm?.info?.model || 'gemini-1.5-flash';
      const status = recordedLlmError?.status ?? null;
      const rawErrorMessage =
        recordedLlmError?.errorMessage ||
        'LLM call failed or candidate ungrounded; fell back to deterministic rules';
      const errorMessage = redactSecrets(rawErrorMessage);

      request.log.warn(
        {
          provider,
          model,
          status,
          error: errorMessage,
        },
        `Agent fell back from LLM path: ${errorMessage}`,
      );

      const fallbackAudit: AuditEvent = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        actor: 'agent',
        kind: 'agent.llm_fallback',
        summary: `Agent fell back from LLM (provider=${provider}, model=${model}, status=${status ?? 'none'}): ${errorMessage}`,
        detail: {
          provider,
          model,
          status,
          error: errorMessage,
        },
      };

      await auditRepo.append(fallbackAudit);
      eventBus.emitEvent({ type: 'audit.appended', payload: fallbackAudit });
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
    }

    // ── Item 1: Supersede older open actions in one database transaction per run ──
    const db = getDb();
    const runInvoiceIds = Array.from(new Set(result.actions.map((a) => a.invoiceId)));
    const newActionIds = new Set(result.actions.map((a) => a.id));
    const supersededItems: { audit: AuditEvent; action: ActionRecord }[] = [];

    await db.transaction(async (tx) => {
      if (runInvoiceIds.length > 0) {
        const olderOpenActions = await tx
          .select()
          .from(actionRecords)
          .where(
            and(
              inArray(actionRecords.invoiceId, runInvoiceIds),
              inArray(actionRecords.status, ['PROPOSED', 'AWAITING_APPROVAL', 'BLOCKED', 'APPROVED']),
            ),
          );

        for (const oldAction of olderOpenActions) {
          if (newActionIds.has(oldAction.id)) {
            continue;
          }

          const supersededReason = oldAction.reason.endsWith('Superseded by a newer agent run')
            ? oldAction.reason
            : `${oldAction.reason} - Superseded by a newer agent run`;

          await tx
            .update(actionRecords)
            .set({
              status: 'REJECTED',
              decidedBy: 'auto',
              reason: supersededReason,
            })
            .where(eq(actionRecords.id, oldAction.id));

          const supersededAudit: AuditEvent = {
            id: randomUUID(),
            ts: new Date().toISOString(),
            actor: 'system',
            kind: 'action.superseded',
            summary: `Action ${oldAction.id} (${oldAction.type}) for invoice ${oldAction.invoiceId} superseded by a newer agent run`,
            invoiceId: oldAction.invoiceId,
            actionId: oldAction.id,
            detail: {
              previousStatus: oldAction.status,
              reason: 'Superseded by a newer agent run',
            },
          };

          await tx.insert(auditEvents).values({
            id: supersededAudit.id,
            ts: supersededAudit.ts,
            actor: supersededAudit.actor,
            kind: supersededAudit.kind,
            summary: supersededAudit.summary,
            invoiceId: supersededAudit.invoiceId,
            actionId: supersededAudit.actionId,
            detail: supersededAudit.detail,
          });

          supersededItems.push({
            audit: supersededAudit,
            action: {
              ...(oldAction as any),
              status: 'REJECTED',
              decidedBy: 'auto',
              reason: supersededReason,
            },
          });
        }
      }

      for (const action of result.actions) {
        await tx
          .insert(actionRecords)
          .values({
            id: action.id,
            invoiceId: action.invoiceId,
            type: action.type,
            params: action.params,
            reason: action.reason,
            simulation: action.simulation,
            policy: action.policy,
            status: action.status,
            createdAt: action.createdAt,
            decidedBy: action.decidedBy,
            executedAt: action.executedAt,
            paypalRequestId: action.paypalRequestId,
            error: action.error,
          })
          .onConflictDoUpdate({
            target: actionRecords.id,
            set: {
              type: action.type,
              params: action.params,
              reason: action.reason,
              simulation: action.simulation,
              policy: action.policy,
              status: action.status,
              createdAt: action.createdAt,
              decidedBy: action.decidedBy,
              executedAt: action.executedAt,
              paypalRequestId: action.paypalRequestId,
              error: action.error,
            },
          });
      }
    });

    for (const item of supersededItems) {
      eventBus.emitEvent({ type: 'audit.appended', payload: item.audit });
      eventBus.emitEvent({ type: 'action.updated', payload: item.action });
    }
    for (const action of result.actions) {
      eventBus.emitEvent({ type: 'action.updated', payload: action });
    }

    // Auto-execute allowed-without-approval actions
    for (const action of result.actions) {
      if (action.status === 'APPROVED' && action.decidedBy === 'auto') {
        try {
          const executed = await actionService.executeAction(action.id, 'auto');
          processedActions.push(executed);
        } catch (autoErr: any) {
          request.log.error({ autoErr, actionId: action.id }, 'Auto-execution of action failed');
          action.status = 'FAILED';
          action.error = autoErr?.message || String(autoErr);
          await actionRepo.update(action);

          const failAudit: AuditEvent = {
            id: randomUUID(),
            ts: new Date().toISOString(),
            actor: 'system',
            kind: 'action.failed',
            summary: `Auto-execution of action ${action.id} (${action.type}) failed: ${action.error}`,
            invoiceId: action.invoiceId,
            actionId: action.id,
            detail: { error: action.error },
          };
          await auditRepo.append(failAudit);
          eventBus.emitEvent({ type: 'audit.appended', payload: failAudit });
          eventBus.emitEvent({ type: 'action.updated', payload: action });
          processedActions.push(action);
        }
      } else {
        processedActions.push(action);
      }
    }

      result.actions = processedActions.map(enrichActionWithDisplayFields);
      return result;
    } finally {
      releaseAgentRunLock();
    }
  });

  // 4. Actions list
  app.get<{ Querystring: { open?: string } }>('/api/actions', async (request) => {
    const isOpen = request.query?.open === 'true';
    const actions = await actionRepo.list({ open: isOpen });
    return actions.map(enrichActionWithDisplayFields);
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

    if (record.status === 'REJECTED' || record.status === 'FAILED') {
      return reply.status(409).send({
        error: {
          code: 'ACTION_NOT_OPEN',
          message: `Action ${id} is closed (${record.status}) and cannot be approved`,
        },
      });
    }

    const executed = await actionService.executeAction(id, 'owner');
    return enrichActionWithDisplayFields(executed);
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
    return enrichActionWithDisplayFields(rejected);
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

  // ── Debug LLM Endpoints (Item 3) ──
  app.get('/api/debug/llm', async (_request, reply) => {
      const currentEnv = getEnv();
      const activeLlm = await getActiveLlm().catch(() => null);

      const requestedProvider =
        (process.env.LLM_PROVIDER || '').trim().toLowerCase() || 'mock';
      const provider = activeLlm?.info?.provider || requestedProvider;
      const model =
        activeLlm?.info?.model ||
        process.env.LLM_MODEL ||
        process.env.GEMINI_MODEL ||
        'mock-model';

      let hasKey = false;
      if (provider === 'gemini') {
        hasKey = !!process.env.GEMINI_API_KEY?.trim();
      } else if (provider === 'anthropic') {
        hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
      } else if (provider === 'openai') {
        hasKey = !!process.env.OPENAI_API_KEY?.trim();
      } else if (provider === 'mock') {
        hasKey = true;
      }

      return reply.send({
        provider,
        model,
        hasKey,
        agentImpl: currentEnv.AGENT_IMPL,
        engineImpl: currentEnv.ENGINE_IMPL,
      });
    },
  );

  app.post(
    '/api/debug/llm/ping',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const start = Date.now();
      try {
        const activeLlm = await getActiveLlm();
        const testRes = await activeLlm.generateStructured<{ reply: string }>({
          system:
            'You are a health probe. Always respond with the JSON object {"reply": "ok"}.',
          user: 'reply with ok',
          jsonSchema: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
            },
            required: ['reply'],
          },
        });

        const latencyMs = Date.now() - start;
        return reply.send({
          ok: true,
          status: 200,
          message: redactSecrets(testRes?.reply || 'ok'),
          latencyMs,
        });
      } catch (err: any) {
        const latencyMs = Date.now() - start;
        const status = err?.status || (err?.statusCode ?? 502);
        const rawMessage = err?.message || String(err);
        const redactedMessage = redactSecrets(rawMessage);

        request.log.warn(
          { err, status, latencyMs },
          `Debug LLM ping failed: ${redactedMessage}`,
        );

        return reply.status(200).send({
          ok: false,
          status,
          message: redactedMessage,
          latencyMs,
        });
      }
    },
  );

  // 9. Audit Events
  app.get('/api/audit', async (request, reply) => {
    const warnings: string[] = [];
    const rawEvents = await auditRepo.list(100);
    const validEvents = filterValidRows(
      rawEvents,
      AuditEventSchema,
      'auditLog',
      request.log,
      request.id,
      warnings,
    );
    if (warnings.length > 0) {
      reply.header('x-settle-warnings', JSON.stringify(warnings));
    }
    const query = request.query as { includeWarnings?: string } | undefined;
    if (query?.includeWarnings === 'true') {
      return { events: validEvents, warnings };
    }
    return validEvents;
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

    // Item 1: First call getInvoice to determine live amount actually due according to PayPal
    const live = (await paypalClient.getInvoice(invoice.paypalInvoiceId)) as {
      status: string;
      amountPaid: number;
      total?: number;
      amountDue?: number;
    };

    // Calculate effective live amount due (current total after discount, minus amount already paid)
    let amountDue: number;
    if (live.amountDue !== undefined) {
      amountDue = live.amountDue;
    } else if (live.total !== undefined) {
      amountDue = Math.max(0, live.total - live.amountPaid);
    } else {
      const discountedTotal = Math.round(invoice.amount * (1 - (invoice.discountPct ?? 0) / 100));
      amountDue = Math.max(0, discountedTotal - live.amountPaid);
    }

    if (amountDue <= 0 || live.status === 'PAID') {
      return reply.status(409).send({
        error: { code: 'NOTHING_DUE', message: 'Invoice has no outstanding balance due' },
      });
    }

    // Determine payment amount (cap at amount due if requested amount is specified)
    let paymentAmount = amountDue;
    if (body.amount !== undefined) {
      paymentAmount = Math.min(body.amount, amountDue);
      if (paymentAmount <= 0) {
        return reply.status(409).send({
          error: { code: 'NOTHING_DUE', message: 'Invoice has no outstanding balance due' },
        });
      }
    }

    let paymentResult: any = { paymentId: `ext_pay_${randomUUID().slice(0, 8)}`, paypalRequestId: randomUUID() };
    if (typeof (paypalClient as any).recordExternalPayment === 'function') {
      try {
        paymentResult = await (paypalClient as any).recordExternalPayment(
          invoice.paypalInvoiceId,
          paymentAmount,
          'Simulated payment via Settle demo',
        );
      } catch (err: any) {
        if (err instanceof PayPalError || err?.name === 'PayPalError') {
          const debugId = err.debugId || err.debug_id || (err.rawError as any)?.debug_id;
          request.log.error(
            {
              err,
              issues: err.issues,
              debugId,
              paypalStatus: err.status,
            },
            `PayPal payment call failed: ${err.message}`
          );
          return reply.status(502).send({
            error: {
              code: 'PAYPAL_ERROR',
              message: err.message || 'PayPal API error',
              debugId: debugId || undefined,
            },
          });
        }
        throw err;
      }
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

  // Demo Reconcile (Item 4: idempotent re-sync one or all provisioned invoices from PayPal)
  app.post('/api/demo/reconcile', async (request, reply) => {
    const body = ReconcileBodySchema.parse(request.body || {});

    if (body?.invoiceId) {
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

      const result = await reconcileService.reconcileInvoicePayment({
        invoiceId: invoice.id,
        paypalInvoiceId: invoice.paypalInvoiceId,
        actor: 'owner',
        eventType: 'demo.reconcile',
      });

      return {
        status: 'ok',
        reconciled: [
          {
            invoiceId: invoice.id,
            paypalInvoiceId: invoice.paypalInvoiceId,
            status: result.invoice.status,
            amountPaid: result.invoice.amountPaid,
            delta: result.delta,
          },
        ],
        newCashBalance: result.newBalance,
        forecast: result.forecast,
      };
    }

    // Reconcile all provisioned invoices
    const allInvoices = await invoiceRepo.list();
    const provisioned = allInvoices.filter((inv) => Boolean(inv.paypalInvoiceId));

    const reconciled = [];
    let lastResult: any;

    for (const inv of provisioned) {
      const res = await reconcileService.reconcileInvoicePayment({
        invoiceId: inv.id,
        paypalInvoiceId: inv.paypalInvoiceId!,
        actor: 'owner',
        eventType: 'demo.reconcile',
      });
      reconciled.push({
        invoiceId: inv.id,
        paypalInvoiceId: inv.paypalInvoiceId!,
        status: res.invoice.status,
        amountPaid: res.invoice.amountPaid,
        delta: res.delta,
      });
      lastResult = res;
    }

    const currentBiz = await businessRepo.get();

    return {
      status: 'ok',
      reconciled,
      newCashBalance: currentBiz?.startingBalance ?? lastResult?.newBalance ?? 0,
      forecast: lastResult?.forecast,
    };
  });

  // 15. Demo Reset
  app.post('/api/demo/reset', async (request, reply) => {
    await repairInvalidAuditActors();
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
