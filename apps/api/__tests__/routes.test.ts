import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resetCachedEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { resetDemoData } from '../src/db/seed.js';
import { closeDb, getDb } from '../src/db/index.js';
import { eventBus } from '../src/events/bus.js';
import { DashboardResponseSchema } from '../src/schemas/index.js';
import { auditEvents, invoices } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('API Routes & Contract v1 Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/settle';
    process.env.WEBHOOK_VERIFY = 'false'; // test mode for webhook verification
    await runMigrations();
    await resetDemoData();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  // ── 1. Dashboard ────────────────────────────────────────────────────────
  describe('GET /api/dashboard', () => {
    it('returns 200 and response strictly conforms to DashboardResponseSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/dashboard',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.business.name).toBe('Maya Studio');
      expect(json.business.currency).toBe('USD');
      expect(json.kpis.cash).toBe(980_000);
      expect(json.kpis.shortfall).toBe(200_000);
      expect(json.overdueInvoices.length).toBe(8);
      expect(json.obligations.length).toBe(3);

      // Validate schema compliance
      const parsed = DashboardResponseSchema.safeParse(json);
      expect(parsed.success).toBe(true);
    });
  });

  // ── 2. Invoices ─────────────────────────────────────────────────────────
  describe('GET /api/invoices', () => {
    it('returns list of invoices', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/invoices',
      });

      expect(res.statusCode).toBe(200);
      const list = JSON.parse(res.payload);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(14);
    });
  });

  // ── 3. Policy (GET and PUT) ─────────────────────────────────────────────
  describe('GET & PUT /api/policy', () => {
    it('GET returns current policy', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/policy',
      });
      expect(res.statusCode).toBe(200);
      const policy = JSON.parse(res.payload);
      expect(policy.maxDiscountPct).toBe(10);
      expect(policy.maxInstalments).toBe(4);
    });

    it('PUT validates request body and rejects invalid policy', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/policy',
        payload: {
          maxDiscountPct: 'not-a-number',
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('PUT updates policy successfully with valid body', async () => {
      const updatedPolicy = {
        maxDiscountPct: 15,
        maxInstalments: 6,
        autoApproveMaxAmount: 300_000,
        requireApprovalFor: ['OFFER_DISCOUNT'],
        quietHours: { startHour: 23, endHour: 6 },
        maxRemindersPerInvoicePerWeek: 4,
      };

      const res = await app.inject({
        method: 'PUT',
        url: '/api/policy',
        payload: updatedPolicy,
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.maxDiscountPct).toBe(15);
      expect(json.maxInstalments).toBe(6);
    });
  });

  // ── 4. Scenario Simulation ──────────────────────────────────────────────
  describe('POST /api/simulate', () => {
    it('validates request body and rejects invalid change payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/simulate',
        payload: {
          change: {
            type: 'UNKNOWN_TYPE',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('simulates REMIND change successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/simulate',
        payload: {
          change: {
            type: 'REMIND',
            invoiceId: 'inv_001',
            newExpectedDate: '2026-11-08',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.change.type).toBe('REMIND');
      expect(json.baseline).toBeDefined();
      expect(json.scenario).toBeDefined();
      expect(json.assumptions.length).toBeGreaterThan(0);
    });

    it('simulates OFFER_DISCOUNT change successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/simulate',
        payload: {
          change: {
            type: 'OFFER_DISCOUNT',
            invoiceId: 'inv_001',
            discountPct: 5,
            newExpectedDate: '2026-11-08',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.cashCost).toBeGreaterThan(0);
    });
  });

  // ── 5. Agent Run & Actions ──────────────────────────────────────────────
  describe('Agent Run & Actions', () => {
    it('POST /api/agent/run generates actions for overdue invoices', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent/run',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.runId).toBeDefined();
      expect(Array.isArray(json.actions)).toBe(true);
      expect(json.actions.length).toBeGreaterThan(0);

      // Verify ghost payer produces ESCALATE action
      const hasEscalate = json.actions.some((a: any) => a.type === 'ESCALATE');
      expect(hasEscalate).toBe(true);
    });

    it('GET /api/actions returns list of actions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/actions',
      });

      expect(res.statusCode).toBe(200);
      const list = JSON.parse(res.payload);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it('POST /api/actions/:id/approve updates status to APPROVED', async () => {
      const listRes = await app.inject({ method: 'GET', url: '/api/actions' });
      const actions = JSON.parse(listRes.payload);
      const target = actions[0];

      const res = await app.inject({
        method: 'POST',
        url: `/api/actions/${target.id}/approve`,
        payload: { note: 'Approved by test' },
      });

      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.payload);
      expect(updated.status).toBe('APPROVED');
      expect(updated.decidedBy).toBe('owner');
    });

    it('POST /api/actions/:id/reject updates status to REJECTED', async () => {
      const listRes = await app.inject({ method: 'GET', url: '/api/actions' });
      const actions = JSON.parse(listRes.payload);
      const target = actions[1] || actions[0];

      const res = await app.inject({
        method: 'POST',
        url: `/api/actions/${target.id}/reject`,
        payload: { note: 'Rejected by test' },
      });

      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.payload);
      expect(updated.status).toBe('REJECTED');
      expect(updated.decidedBy).toBe('owner');
    });

    it('POST /api/actions/:id/approve returns 404 for nonexistent action', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/actions/nonexistent_id/approve',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ── 6. Chat ─────────────────────────────────────────────────────────────
  describe('POST /api/chat', () => {
    it('validates question string and rejects empty question', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { question: '' },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('answers question grounded in current financial state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { question: 'What is our current cash shortfall?' },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.text).toContain('shortfall');
      expect(json.forecast).toBeDefined();
    });
  });

  // ── 7. Audit Log ────────────────────────────────────────────────────────
  describe('GET /api/audit', () => {
    it('returns audit events', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit',
      });

      expect(res.statusCode).toBe(200);
      const list = JSON.parse(res.payload);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });
  });

  // ── 8. SSE Hub & Event Delivery ─────────────────────────────────────────
  describe('SSE Hub Event Delivery', () => {
    it('emits events to subscribers upon simulated invoice update', async () => {
      const receivedEvents: any[] = [];
      const unsubscribe = eventBus.onEvent((evt) => {
        receivedEvents.push(evt);
      });

      // Emit simulated invoice.updated event
      const testInvoice = {
        id: 'inv_001',
        payerId: 'pay_003',
        number: 'INV-1001',
        description: 'Web design – Phase 2',
        amount: 350_000,
        amountPaid: 350_000,
        issueDate: '2026-10-21',
        dueDate: '2026-10-31',
        status: 'PAID' as const,
        discountPct: 0,
        allowPartial: false,
      };

      eventBus.emitEvent({
        type: 'invoice.updated',
        payload: testInvoice,
      });

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].type).toBe('invoice.updated');
      expect(receivedEvents[0].payload.id).toBe('inv_001');
      expect(receivedEvents[0].payload.status).toBe('PAID');

      unsubscribe();
    });
  });

  // ── 9. PayPal Webhook Handler ───────────────────────────────────────────
  describe('POST /api/webhooks/paypal', () => {
    it('rejects webhook when signature verification fails', async () => {
      // Temporarily enable verification with missing credentials
      process.env.WEBHOOK_VERIFY = 'true';
      delete process.env.PAYPAL_WEBHOOK_ID;
      resetCachedEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/paypal',
        headers: {
          'paypal-transmission-id': 'mock-tx-1',
        },
        payload: {
          id: 'WH-TEST-SIG-FAIL',
          event_type: 'INVOICING.INVOICE.PAID',
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('INVALID_SIGNATURE');

      process.env.WEBHOOK_VERIFY = 'false';
      resetCachedEnv();
    });

    it('idempotency: the same webhook event delivered twice changes state once', async () => {
      process.env.WEBHOOK_VERIFY = 'false';

      // Set up an invoice with paypalInvoiceId
      const db = getDb();
      await db
        .update(invoices)
        .set({ paypalInvoiceId: 'INV2-WEBHOOK-TEST' })
        .where(eq(invoices.id, 'inv_002'));

      const webhookPayload = {
        id: 'WH-EVENT-IDEMPOTENCY-001',
        event_type: 'INVOICING.INVOICE.PAID',
        resource: {
          invoice: {
            id: 'INV2-WEBHOOK-TEST',
          },
        },
      };

      // Mock paypalClient.getInvoice on the app instance
      const customApp = await buildApp({
        paypalClient: {
          getInvoice: vi.fn().mockResolvedValue({
            status: 'PAID',
            amountPaid: 320_000,
          }),
        } as any,
      });
      await customApp.ready();

      // First delivery
      const res1 = await customApp.inject({
        method: 'POST',
        url: '/api/webhooks/paypal',
        payload: webhookPayload,
      });

      expect(res1.statusCode).toBe(200);
      const data1 = JSON.parse(res1.payload);
      expect(data1.handled).toBe(true);
      expect(data1.duplicate).toBe(false);

      // Verify invoice was updated to PAID
      const invCheck = await db.select().from(invoices).where(eq(invoices.id, 'inv_002')).limit(1);
      expect(invCheck[0].status).toBe('PAID');
      expect(invCheck[0].amountPaid).toBe(320_000);

      // Count audit events
      const audits1 = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.paypalRequestId, 'WH-EVENT-IDEMPOTENCY-001'));
      expect(audits1.length).toBe(1);

      // Second delivery (duplicate)
      const res2 = await customApp.inject({
        method: 'POST',
        url: '/api/webhooks/paypal',
        payload: webhookPayload,
      });

      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.handled).toBe(true);
      expect(data2.duplicate).toBe(true); // Flagged as duplicate!

      // Verify no duplicate audit event was created
      const audits2 = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.paypalRequestId, 'WH-EVENT-IDEMPOTENCY-001'));
      expect(audits2.length).toBe(1); // Still exactly 1!

      await customApp.close();
    });

    it('superseded invoice cancellation logs audit event and does not cancel active invoice', async () => {
      process.env.WEBHOOK_VERIFY = 'false';
      const db = getDb();

      // Setup an active invoice and mark an old paypalInvoiceId as replaced
      const { invoicePayPalIds } = await import('../src/db/schema.js');
      await db.insert(invoicePayPalIds).values({
        id: 'ipp_test_superseded',
        invoiceId: 'inv_003',
        paypalInvoiceId: 'INV2-OLD-REPLACED-ID',
        createdAt: new Date().toISOString(),
        replacedAt: new Date().toISOString(),
        reason: 'cancelled_and_reissued',
      });

      const customApp = await buildApp();
      await customApp.ready();

      const cancelEvent = {
        id: 'WH-EVENT-SUPERSEDED-CANCEL-001',
        event_type: 'INVOICING.INVOICE.CANCELLED',
        resource: {
          invoice: {
            id: 'INV2-OLD-REPLACED-ID',
          },
        },
      };

      const res = await customApp.inject({
        method: 'POST',
        url: '/api/webhooks/paypal',
        payload: cancelEvent,
      });

      expect(res.statusCode).toBe(200);

      // Verify our active invoice status was NOT changed to CANCELLED
      const invCheck = await db.select().from(invoices).where(eq(invoices.id, 'inv_003')).limit(1);
      expect(invCheck[0].status).not.toBe('CANCELLED');

      // Verify audit event recorded "superseded invoice cancelled"
      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.invoiceId, 'inv_003'));
      const supersededAudit = audits.find((a) => a.kind === 'invoice.superseded_cancelled');
      expect(supersededAudit).toBeDefined();

      await customApp.close();
    });
  });

  // ── 10. Demo Reset ──────────────────────────────────────────────────────
  describe('POST /api/demo/reset', () => {
    it('restores database to baseline seed scenario', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/demo/reset',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.status).toBe('ok');
      expect(json.business).toBe('Maya Studio');
      expect(json.invoicesCount).toBe(14);
    });
  });
});
