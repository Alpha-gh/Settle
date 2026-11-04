import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type {
  Invoice,
  Payer,
  PayPalPort,
  Cents,
  ISODate,
  InvoiceStatus,
  ActionRecord,
} from '@settle/shared';
import { buildApp } from '../src/app.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import {
  InvoiceRepository,
  ActionRecordRepository,
  AuditEventRepository,
  InvoicePayPalIdRepository,
  PolicyRepository,
} from '../src/db/repositories.js';

class FakePayPal implements PayPalPort {
  public createdInvoices: Array<{ inv: Invoice; payer: Payer }> = [];
  public remindersSent: Array<{ paypalInvoiceId: string; note: string }> = [];
  public updatedInvoices: Array<{ paypalInvoiceId: string; patch: any }> = [];
  public cancelledInvoices: string[] = [];
  public recordedPayments: Array<{ paypalInvoiceId: string; amount: Cents }> = [];
  public auditTrail: Array<{ paypalRequestId: string; httpStatus: number; operation: string }> = [];

  public failOnChildIndex: number | null = null;
  public failOnUpdate = false;
  private childCounter = 0;

  async createAndSendInvoice(inv: Invoice, payer: Payer): Promise<{ paypalInvoiceId: string; payUrl: string }> {
    this.childCounter++;
    if (this.failOnChildIndex !== null && this.childCounter === this.failOnChildIndex) {
      throw new Error(`Simulated PayPal failure creating child invoice ${inv.number}`);
    }

    const reqId = `pp-req-${randomUUID()}`;
    const paypalInvoiceId = `PP-INV-${randomUUID().slice(0, 8)}`;
    this.createdInvoices.push({ inv, payer });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 201, operation: 'createAndSendInvoice' });

    return {
      paypalInvoiceId,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`,
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
    if (this.failOnUpdate) {
      throw new Error('Simulated PayPal failure on updateInvoice');
    }
    const reqId = `pp-req-${randomUUID()}`;
    this.updatedInvoices.push({ paypalInvoiceId, patch });
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'updateInvoice' });
  }

  async cancelInvoice(paypalInvoiceId: string): Promise<void> {
    const reqId = `pp-req-${randomUUID()}`;
    this.cancelledInvoices.push(paypalInvoiceId);
    this.auditTrail.push({ paypalRequestId: reqId, httpStatus: 200, operation: 'cancelInvoice' });
  }

  async getInvoice(paypalInvoiceId: string): Promise<{ status: InvoiceStatus; amountPaid: Cents }> {
    const payments = this.recordedPayments.filter((p) => p.paypalInvoiceId === paypalInvoiceId);
    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
    return {
      status: totalPaid > 0 ? 'PAID' : 'SENT',
      amountPaid: totalPaid,
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

describe('Stage 4 - Core System 1 Integration & FakePayPal Tests', () => {
  let app: FastifyInstance;
  let fakePayPal: FakePayPal;
  let invoiceRepo: InvoiceRepository;
  let actionRepo: ActionRecordRepository;
  let auditRepo: AuditEventRepository;
  let historyRepo: InvoicePayPalIdRepository;
  let policyRepo: PolicyRepository;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
    await setupTestDatabase();

    fakePayPal = new FakePayPal();
    invoiceRepo = new InvoiceRepository();
    actionRepo = new ActionRecordRepository();
    auditRepo = new AuditEventRepository();
    historyRepo = new InvoicePayPalIdRepository();
    policyRepo = new PolicyRepository();

    app = await buildApp({ paypalClient: fakePayPal as any });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('1. NOT-PROVISIONED Guard returns 409 for unprovisioned invoice', async () => {
    // Reset data
    await app.inject({ method: 'POST', url: '/api/demo/reset' });

    // Target inv_001 which is not provisioned
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      payload: { invoiceId: 'inv_001' },
    });
    expect(runRes.statusCode).toBe(409);
    const runErr = JSON.parse(runRes.payload);
    expect(runErr.error.code).toBe('NOT_PROVISIONED');

    // Create an unprovisioned action directly in DB and attempt approve
    const unprovAction: ActionRecord = {
      id: `act_unprov_${Date.now()}`,
      invoiceId: 'inv_001',
      type: 'REMIND',
      params: { note: 'Unprovisioned test reminder' },
      reason: 'Testing 409 guard',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(unprovAction);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${unprovAction.id}/approve`,
    });
    expect(approveRes.statusCode).toBe(409);
    const approveErr = JSON.parse(approveRes.payload);
    expect(approveErr.error.code).toBe('NOT_PROVISIONED');
  });

  it('2. Provisioning: POST /api/demo/provision-paypal provisions SENT invoices', async () => {
    const provRes = await app.inject({
      method: 'POST',
      url: '/api/demo/provision-paypal',
    });
    expect(provRes.statusCode).toBe(200);
    const provJson = JSON.parse(provRes.payload);
    expect(provJson.provisioned).toBeGreaterThan(0);

    // Verify invoice has paypalInvoiceId in DB
    const inv1 = await invoiceRepo.getById('inv_001');
    expect(inv1?.paypalInvoiceId).toBeDefined();
    expect(inv1?.payUrl).toContain('paypal.com');

    // Idempotent: running again skips already provisioned
    const provRes2 = await app.inject({
      method: 'POST',
      url: '/api/demo/provision-paypal',
    });
    const provJson2 = JSON.parse(provRes2.payload);
    expect(provJson2.provisioned).toBe(0);
    expect(provJson2.skipped).toBeGreaterThan(0);
  });

  it('3. REMIND action execution: replaces {{PAY_URL}} and sends PayPal reminder', async () => {
    const inv1 = (await invoiceRepo.getById('inv_001'))!;
    const actionId = `act_remind_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv1.id,
      type: 'REMIND',
      params: { note: 'Please pay your bill at {{PAY_URL}} immediately.' },
      reason: 'Overdue reminder',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const res = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const executed = JSON.parse(res.payload);
    expect(executed.status).toBe('EXECUTED');
    expect(executed.decidedBy).toBe('owner');
    expect(executed.paypalRequestId).toBeDefined();

    // Verify reminder note replaced {{PAY_URL}}
    const sent = fakePayPal.remindersSent.find((r) => r.paypalInvoiceId === inv1.paypalInvoiceId);
    expect(sent).toBeDefined();
    expect(sent?.note).toContain(inv1.payUrl);
    expect(sent?.note).not.toContain('{{PAY_URL}}');
  });

  it('4. OFFER_DISCOUNT action execution: updates invoice, rounds half-up, updates DB', async () => {
    const inv2 = (await invoiceRepo.getById('inv_002'))!;
    const actionId = `act_disc_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv2.id,
      type: 'OFFER_DISCOUNT',
      params: { discountPct: 5 },
      reason: 'Prompt pay discount',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const res = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const executed = JSON.parse(res.payload);
    expect(executed.status).toBe('EXECUTED');

    // Verify PayPal update was called
    const ppUpdate = fakePayPal.updatedInvoices.find((u) => u.paypalInvoiceId === inv2.paypalInvoiceId);
    expect(ppUpdate).toBeDefined();
    expect(ppUpdate?.patch.discountPct).toBe(5);

    // Verify invoice in DB was updated with discountPct and new dueDate
    const updatedInv = await invoiceRepo.getById(inv2.id);
    expect(updatedInv?.discountPct).toBe(5);
    expect(updatedInv?.dueDate).not.toBe(inv2.dueDate);
  });

  it('5. OFFER_INSTALMENTS action execution: splits remaining with remainder cents on part 1, cancels parent', async () => {
    const inv3 = (await invoiceRepo.getById('inv_003'))!;
    const remaining = inv3.amount - inv3.amountPaid; // 280,000 cents
    const count = 3;
    // 280000 / 3 = 93333 with remainder 1 cent -> part 1 = 93334, parts 2 & 3 = 93333

    const actionId = `act_inst_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv3.id,
      type: 'OFFER_INSTALMENTS',
      params: { instalments: { count, spacingDays: 14 } },
      reason: 'Instalment plan',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const res = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const executed = JSON.parse(res.payload);
    expect(executed.status).toBe('EXECUTED');

    // Verify children created in DB
    const allInvoices = await invoiceRepo.list();
    const children = allInvoices.filter((i) => i.number.startsWith(`${inv3.number}-`));
    expect(children.length).toBe(3);

    // Remainder cent on first child
    expect(children[0].amount).toBe(Math.floor(remaining / 3) + (remaining % 3));
    expect(children[1].amount).toBe(Math.floor(remaining / 3));
    expect(children[2].amount).toBe(Math.floor(remaining / 3));
    expect(children[0].amount + children[1].amount + children[2].amount).toBe(remaining);

    // Parent is CANCELLED in DB
    const parent = await invoiceRepo.getById(inv3.id);
    expect(parent?.status).toBe('CANCELLED');

    // Parent cancelled on PayPal
    expect(fakePayPal.cancelledInvoices).toContain(inv3.paypalInvoiceId);

    // History marked superseded
    const history = await historyRepo.findByPayPalId(inv3.paypalInvoiceId!);
    expect(history?.replacedAt).toBeDefined();
    expect(history?.reason).toBe('split_into_instalments');
  });

  it('6. OFFER_INSTALMENTS rollback on failure: cancels created children, leaves parent untouched, marks FAILED', async () => {
    const inv4 = (await invoiceRepo.getById('inv_004'))!;
    const initialCreatedCount = fakePayPal.createdInvoices.length;

    // Configure fake to fail on child 2
    fakePayPal.failOnChildIndex = initialCreatedCount + 2;

    const actionId = `act_inst_fail_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv4.id,
      type: 'OFFER_INSTALMENTS',
      params: { instalments: { count: 3, spacingDays: 7 } },
      reason: 'Test rollback',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const res = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.payload);
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('Simulated PayPal failure');

    // Reset failure trigger
    fakePayPal.failOnChildIndex = null;

    // Parent remains untouched (status is still SENT, not CANCELLED)
    const parent = await invoiceRepo.getById(inv4.id);
    expect(parent?.status).toBe('SENT');

    // No children persisted in DB for inv4
    const allInvoices = await invoiceRepo.list();
    const children = allInvoices.filter((i) => i.number.startsWith(`${inv4.number}-`));
    expect(children.length).toBe(0);
  });

  it('7. Idempotency & Per-action Lock: concurrent approvals execute once', async () => {
    const inv5 = (await invoiceRepo.getById('inv_005'))!;
    const actionId = `act_lock_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv5.id,
      type: 'REMIND',
      params: { note: 'Concurrency test' },
      reason: 'Concurrent approvals test',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    // Call approve concurrently
    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/actions/${actionId}/approve` }),
      app.inject({ method: 'POST', url: `/api/actions/${actionId}/approve` }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res1.payload).status).toBe('EXECUTED');
    expect(JSON.parse(res2.payload).status).toBe('EXECUTED');

    // Subsequent call is idempotent
    const res3 = await app.inject({ method: 'POST', url: `/api/actions/${actionId}/approve` });
    expect(res3.statusCode).toBe(200);
    expect(JSON.parse(res3.payload).status).toBe('EXECUTED');
  });

  it('8. Policy violation at approval time blocks execution', async () => {
    const inv6 = (await invoiceRepo.getById('inv_006'))!;
    const actionId = `act_viol_${Date.now()}`;
    // Discount exceeds policy max (max is 5, requesting 25)
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv6.id,
      type: 'OFFER_DISCOUNT',
      params: { discountPct: 25 },
      reason: 'Excessive discount',
      policy: { allowed: false, requiresApproval: true, violations: ['Exceeds max discount'] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const res = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('BLOCKED');
    expect(json.policy.allowed).toBe(false);

    // Verify audit event written
    const audits = await auditRepo.list(10);
    const blockAudit = audits.find((a) => a.actionId === actionId && a.kind === 'action.blocked_by_policy');
    expect(blockAudit).toBeDefined();
  });

  it('9. Demo Payment: POST /api/demo/simulate-payment reconciles immediately and updates dashboard', async () => {
    const inv7 = (await invoiceRepo.getById('inv_007'))!;
    expect(inv7.paypalInvoiceId).toBeDefined();

    // Get baseline dashboard shortfall
    const dash1 = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const shortfallBefore = JSON.parse(dash1.payload).kpis.shortfall;

    // Simulate paying invoice in full
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: inv7.id },
    });
    expect(payRes.statusCode).toBe(200);
    const payJson = JSON.parse(payRes.payload);
    expect(payJson.status).toBe('ok');
    expect(payJson.invoice.status).toBe('PAID');
    expect(payJson.invoice.amountPaid).toBe(inv7.amount);

    // Audit event recorded
    const audits = await auditRepo.list(10);
    const payAudit = audits.find((a) => a.invoiceId === inv7.id && a.kind === 'invoice.paid');
    expect(payAudit).toBeDefined();

    // Dashboard recomputes dynamically
    const dash2 = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const dashJson = JSON.parse(dash2.payload);
    const paidInv = dashJson.invoices.find((i: any) => i.id === inv7.id);
    expect(paidInv.status).toBe('PAID');
  });

  it('10. Chat & Simulate return grounded live responses', async () => {
    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question: 'What is our current cash position?' },
    });
    expect(chatRes.statusCode).toBe(200);
    const chatJson = JSON.parse(chatRes.payload);
    expect(chatJson.text).toContain('cash');
    expect(chatJson.forecast).toBeDefined();

    const simRes = await app.inject({
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
    expect(simRes.statusCode).toBe(200);
    const simJson = JSON.parse(simRes.payload);
    expect(simJson.scenario).toBeDefined();
    expect(simJson.baseline).toBeDefined();
  });
});
