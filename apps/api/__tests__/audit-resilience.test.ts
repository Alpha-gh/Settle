import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  Invoice,
  Payer,
  PayPalPort,
  Cents,
  ISODate,
  InvoiceStatus,
  ActionRecord,
  AuditEvent,
} from '@settle/shared';
import { buildApp } from '../src/app.js';
import { resetCachedEnv } from '../src/config/env.js';
import { getDb, getRawSql, closeDb } from '../src/db/index.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { repairInvalidAuditActors } from '../src/db/migrate.js';
import { auditEvents } from '../src/db/schema.js';
import { PolicyRepository } from '../src/db/repositories.js';
import { AuditActorSchema, DashboardResponseSchema } from '../src/schemas/index.js';
import { PaymentReconciliationService } from '../src/services/reconciliation.js';
import { eq } from 'drizzle-orm';

class FakePayPal implements PayPalPort {
  public createdInvoices: Array<{ inv: Invoice; payer: Payer }> = [];
  public remindersSent: Array<{ paypalInvoiceId: string; note: string }> = [];
  public updatedInvoices: Array<{ paypalInvoiceId: string; patch: unknown }> = [];
  public cancelledInvoices: string[] = [];
  public recordedPayments: Array<{ paypalInvoiceId: string; amount: Cents }> = [];
  public auditTrail: Array<{ paypalRequestId: string; httpStatus: number; operation: string }> = [];

  async createAndSendInvoice(
    inv: Invoice,
    payer: Payer,
  ): Promise<{ paypalInvoiceId: string; payUrl: string; paypalInvoiceNumber?: string }> {
    const reqId = `pp-req-${randomUUID()}`;
    const paypalInvoiceId = `PP-INV-${randomUUID().slice(0, 8)}`;
    this.createdInvoices.push({ inv: { ...inv, paypalInvoiceId }, payer });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 201, operation: 'createAndSendInvoice' });
    return {
      paypalInvoiceId,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`,
      paypalInvoiceNumber: `${inv.number}-${randomUUID().slice(0, 4).toUpperCase()}`,
    };
  }

  async sendReminder(paypalInvoiceId: string, note: string): Promise<void> {
    const reqId = `pp-req-${randomUUID()}`;
    this.remindersSent.push({ paypalInvoiceId, note });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'sendReminder' });
  }

  async updateInvoice(
    paypalInvoiceId: string,
    patch: { discountPct?: number; dueDate?: ISODate; allowPartial?: boolean; minimumAmountDue?: Cents },
  ): Promise<void> {
    const reqId = `pp-req-${randomUUID()}`;
    this.updatedInvoices.push({ paypalInvoiceId, patch });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'updateInvoice' });
  }

  async cancelInvoice(paypalInvoiceId: string): Promise<void> {
    const reqId = `pp-req-${randomUUID()}`;
    this.cancelledInvoices.push(paypalInvoiceId);
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'cancelInvoice' });
  }

  async getInvoice(
    paypalInvoiceId: string,
  ): Promise<{ status: InvoiceStatus; amountPaid: Cents; total?: Cents; amountDue?: Cents }> {
    const payments = this.recordedPayments.filter((p) => p.paypalInvoiceId === paypalInvoiceId);
    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
    const created = this.createdInvoices.find((c) => c.inv.paypalInvoiceId === paypalInvoiceId);
    const baseAmount = created?.inv.amount ?? 0;
    return {
      status: baseAmount > 0 && totalPaid >= baseAmount ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'SENT',
      amountPaid: totalPaid,
      total: baseAmount || undefined,
      amountDue: baseAmount ? Math.max(0, baseAmount - totalPaid) : undefined,
    };
  }

  async recordExternalPayment(
    paypalInvoiceId: string,
    amountCents: Cents,
  ): Promise<{ paymentId: string; httpStatus: number; paypalRequestId: string }> {
    const reqId = `pp-req-${randomUUID()}`;
    this.recordedPayments.push({ paypalInvoiceId, amount: amountCents });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'recordExternalPayment' });
    return {
      paymentId: `PAY-${randomUUID().slice(0, 8)}`,
      httpStatus: 200,
      paypalRequestId: reqId,
    };
  }

  getAuditTrail() {
    return this.auditTrail;
  }
}

describe('Audit Actor Safety, Startup Repair Migration, and Dashboard/Audit Resilience (Item 5)', () => {
  let app: FastifyInstance;
  let fakePayPal: FakePayPal;

  async function assertDashboardAndAuditValid() {
    const dashRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(dashRes.statusCode).toBe(200);
    const dashBody = JSON.parse(dashRes.payload);
    expect(() => DashboardResponseSchema.parse(dashBody)).not.toThrow();

    const auditRes = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(auditRes.statusCode).toBe(200);
    const events: AuditEvent[] = JSON.parse(auditRes.payload);
    for (const evt of events) {
      expect(AuditActorSchema.safeParse(evt.actor).success).toBe(true);
    }
    return { dashBody, events };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENGINE_IMPL = 'real';
    process.env.AGENT_IMPL = 'real';
    process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
    process.env.WEBHOOK_VERIFY = 'false';
    delete process.env.GEMINI_API_KEY;

    resetCachedEnv();
    await setupTestDatabase();
    fakePayPal = new FakePayPal();
    app = await buildApp({ paypalClient: fakePayPal });
    await app.ready();
  });

  afterAll(async () => {
    resetCachedEnv();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('produces valid AuditActor values and 200 DashboardResponseSchema across all code paths', async () => {
    // 1. Reset
    const resetRes = await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    expect(resetRes.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    // Disable auto-approve so we can exercise approve, reject, escalate, and supersede cleanly
    const policyRepo = new PolicyRepository();
    const policy = await policyRepo.get();
    await policyRepo.update({ ...policy, autoApproveMaxAmount: 0 });

    // 2. Provision
    const provRes = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
    expect(provRes.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    // 3. Agent run #1
    const run1Res = await app.inject({ method: 'POST', url: '/api/agent/run', payload: {} });
    expect(run1Res.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    // 4. Agent run #2 (supersedes run #1 open actions)
    const run2Res = await app.inject({ method: 'POST', url: '/api/agent/run', payload: {} });
    expect(run2Res.statusCode).toBe(200);
    const run2Body = JSON.parse(run2Res.payload);
    const openActions: ActionRecord[] = run2Body.actions.filter(
      (a: ActionRecord) => a.status === 'AWAITING_APPROVAL',
    );
    await assertDashboardAndAuditValid();

    // 5. Approve one action (e.g. OFFER_DISCOUNT / REMIND) and one ESCALATE
    const nonEscalate = openActions.find((a) => a.type !== 'ESCALATE')!;
    const escalateAct = openActions.find((a) => a.type === 'ESCALATE')!;
    const rejectCandidate = openActions.find((a) => a.id !== nonEscalate.id && a.id !== escalateAct.id)!;

    const appRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${nonEscalate.id}/approve`,
      payload: {},
    });
    expect(appRes.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    const escRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${escalateAct.id}/approve`,
      payload: {},
    });
    expect(escRes.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    // 6. Reject an action
    const rejRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${rejectCandidate.id}/reject`,
      payload: { note: 'Hold off' },
    });
    expect(rejRes.statusCode).toBe(200);
    await assertDashboardAndAuditValid();

    // 7. Reconcile via manual endpoint (actor: 'owner')
    const recRes = await app.inject({
      method: 'POST',
      url: '/api/demo/reconcile',
      payload: { invoiceId: 'inv_002' },
    });
    expect(recRes.statusCode).toBe(200);
    const afterManual = await assertDashboardAndAuditValid();
    expect(afterManual.events.some((e) => e.kind === 'demo.reconcile' && e.actor === 'owner')).toBe(true);

    // 8. Reconcile via sync job path (actor: 'system')
    const createdInv2 = fakePayPal.createdInvoices.find((c) => c.inv.id === 'inv_002')!;
    const reconcileService = new PaymentReconciliationService(fakePayPal);
    await reconcileService.reconcileInvoicePayment({
      invoiceId: 'inv_002',
      paypalInvoiceId: createdInv2.inv.paypalInvoiceId!,
      actor: 'system',
      eventType: 'sync.reconcile',
    });
    const afterSync = await assertDashboardAndAuditValid();
    expect(afterSync.events.some((e) => e.kind === 'sync.reconcile' && e.actor === 'system')).toBe(true);

    // 9. Reconcile via PayPal webhook (actor: 'paypal')
    const createdInv1 = fakePayPal.createdInvoices.find((c) => c.inv.id === 'inv_001')!;
    await fakePayPal.recordExternalPayment(createdInv1.inv.paypalInvoiceId!, 10000);
    const whRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paypal',
      payload: {
        id: `WH-${randomUUID()}`,
        event_type: 'INVOICING.INVOICE.PAID',
        resource: {
          invoice: {
            id: createdInv1.inv.paypalInvoiceId,
            status: 'PAID',
          },
        },
      },
    });
    expect(whRes.statusCode).toBe(200);
    const afterWh = await assertDashboardAndAuditValid();
    expect(afterWh.events.some((e) => e.actor === 'paypal')).toBe(true);
  });

  it('repairs legacy audit rows with actor "manual" to "system" while preserving detail.originalActor', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    const db = getDb();
    const sql = getRawSql();
    const legacyId = `aud_legacy_${randomUUID().slice(0, 8)}`;

    await sql.unsafe(
      `INSERT INTO audit_events (id, ts, actor, kind, summary, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        legacyId,
        new Date().toISOString(),
        'manual',
        'demo.reconcile',
        'Legacy manual sync',
        JSON.stringify({ delta: 0 }),
      ],
    );

    const fixedCount = await repairInvalidAuditActors();
    expect(fixedCount).toBe(1);

    // Running again is idempotent
    const secondCount = await repairInvalidAuditActors();
    expect(secondCount).toBe(0);

    const [repaired] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, legacyId))
      .limit(1);

    expect(repaired?.actor).toBe('system');
    expect((repaired?.detail as Record<string, unknown>)?.originalActor).toBe('manual');
    expect((repaired?.detail as Record<string, unknown>)?.delta).toBe(0);
  });

  it('drops bad audit rows and returns 200 with warnings on /api/dashboard and /api/audit', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    const sql = getRawSql();
    const badId = `aud_bad_${randomUUID().slice(0, 8)}`;

    try {
      await sql.unsafe(
        `INSERT INTO audit_events (id, ts, actor, kind, summary) VALUES ($1, $2, $3, $4, $5)`,
        [badId, new Date().toISOString(), 'unexpected_actor', 'demo.reconcile', 'Corrupt row'],
      );

      const dashRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
      expect(dashRes.statusCode).toBe(200);
      const dashBody = JSON.parse(dashRes.payload);
      expect(() => DashboardResponseSchema.parse(dashBody)).not.toThrow();
      expect(dashBody.auditLog.some((e: AuditEvent) => e.id === badId)).toBe(false);
      expect(dashBody.warnings.length).toBeGreaterThan(0);
      expect(dashBody.warnings.some((w: string) => w.includes(badId))).toBe(true);

      const auditRes = await app.inject({ method: 'GET', url: '/api/audit' });
      expect(auditRes.statusCode).toBe(200);
      const auditList: AuditEvent[] = JSON.parse(auditRes.payload);
      expect(auditList.some((e) => e.id === badId)).toBe(false);
      expect(auditRes.headers['x-settle-warnings']).toBeDefined();

      const auditWithWarningsRes = await app.inject({
        method: 'GET',
        url: '/api/audit?includeWarnings=true',
      });
      expect(auditWithWarningsRes.statusCode).toBe(200);
      const auditWithWarnings = JSON.parse(auditWithWarningsRes.payload);
      expect(auditWithWarnings.warnings.some((w: string) => w.includes(badId))).toBe(true);
    } finally {
      await sql.unsafe(`DELETE FROM audit_events WHERE id = $1`, [badId]);
    }
  });
});
