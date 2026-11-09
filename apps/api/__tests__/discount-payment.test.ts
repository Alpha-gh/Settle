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
  Snapshot,
} from '@settle/shared';
import { buildApp } from '../src/app.js';
import { PayPalError } from '../src/paypal/errors.js';
import { resetCachedEnv } from '../src/config/env.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { closeDb } from '../src/db/index.js';
import {
  InvoiceRepository,
  ActionRecordRepository,
  BusinessRepository,
  PayerRepository,
  ObligationRepository,
} from '../src/db/repositories.js';
import { getEngine } from '../src/adapters/engine.js';

class FakePayPalForPaymentTests implements PayPalPort {
  public createdInvoices: Array<{ inv: Invoice; payer: Payer; paypalInvoiceId: string }> = [];
  public updatedInvoices: Array<{ paypalInvoiceId: string; patch: any }> = [];
  public recordedPayments: Array<{ paypalInvoiceId: string; amount: Cents }> = [];
  public cancelledInvoices: string[] = [];
  public remindersSent: Array<{ paypalInvoiceId: string; note: string }> = [];
  public failOnRecordPayment = false;

  async createAndSendInvoice(inv: Invoice, payer: Payer): Promise<{ paypalInvoiceId: string; payUrl: string }> {
    const paypalInvoiceId = `PP-${inv.id || randomUUID().slice(0, 8)}`;
    this.createdInvoices.push({ inv, payer, paypalInvoiceId });
    return {
      paypalInvoiceId,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`,
    };
  }

  async sendReminder(paypalInvoiceId: string, note: string): Promise<void> {
    this.remindersSent.push({ paypalInvoiceId, note });
  }

  async updateInvoice(
    paypalInvoiceId: string,
    patch: { discountPct?: number; dueDate?: ISODate; allowPartial?: boolean; minimumAmountDue?: Cents },
  ): Promise<void> {
    this.updatedInvoices.push({ paypalInvoiceId, patch });
  }

  async cancelInvoice(paypalInvoiceId: string): Promise<void> {
    this.cancelledInvoices.push(paypalInvoiceId);
  }

  async getInvoice(
    paypalInvoiceId: string,
  ): Promise<{ status: InvoiceStatus; amountPaid: Cents; total?: Cents; amountDue?: Cents }> {
    const payments = this.recordedPayments.filter((p) => p.paypalInvoiceId === paypalInvoiceId);
    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);

    const created = this.createdInvoices.find((c) => c.paypalInvoiceId === paypalInvoiceId);
    const updates = this.updatedInvoices.filter((u) => u.paypalInvoiceId === paypalInvoiceId);
    const latestDiscount = updates.slice().reverse().find((u) => u.patch.discountPct !== undefined)?.patch.discountPct;

    let total: Cents | undefined;
    if (created) {
      const baseAmount = created.inv.amount;
      total = latestDiscount !== undefined ? Math.round((baseAmount * (100 - latestDiscount)) / 100) : baseAmount;
    }

    const amountDue = total !== undefined ? Math.max(0, total - totalPaid) : undefined;
    const isPaid = total !== undefined ? totalPaid >= total : totalPaid > 0;

    return {
      status: isPaid ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'SENT',
      amountPaid: totalPaid,
      total,
      amountDue,
    };
  }

  async recordExternalPayment(
    paypalInvoiceId: string,
    amountCents: Cents,
  ): Promise<{ paymentId: string; httpStatus: number; paypalRequestId: string }> {
    if (this.failOnRecordPayment) {
      throw new PayPalError({
        message: 'PayPal payment rejected: simulated upstream error',
        status: 422,
        debugId: 'fake-debug-id-422',
        details: [{ issue: 'AMOUNT_GREATER_THAN_DUE' }],
      });
    }

    this.recordedPayments.push({ paypalInvoiceId, amount: amountCents });
    return {
      paymentId: `PAY-${randomUUID().slice(0, 8)}`,
      httpStatus: 200,
      paypalRequestId: `req-${randomUUID().slice(0, 8)}`,
    };
  }
}

describe('PayPal Discount Payment, Reconciliation, and Error Handling (Tasks 1-5)', () => {
  let app: FastifyInstance;
  let fakePayPal: FakePayPalForPaymentTests;
  let invoiceRepo: InvoiceRepository;
  let actionRepo: ActionRecordRepository;
  let businessRepo: BusinessRepository;
  let payerRepo: PayerRepository;
  let obligationRepo: ObligationRepository;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POLICY_IGNORE_QUIET_HOURS = 'true';
    process.env.ENGINE_IMPL = 'real';
    resetCachedEnv();

    await setupTestDatabase();

    fakePayPal = new FakePayPalForPaymentTests();
    invoiceRepo = new InvoiceRepository();
    actionRepo = new ActionRecordRepository();
    businessRepo = new BusinessRepository();
    payerRepo = new PayerRepository();
    obligationRepo = new ObligationRepository();

    app = await buildApp({ paypalClient: fakePayPal as any });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  // ── Task 3: Double-discounting prevention unit test ────────────────────────
  it('Task 3: verifies a 2% discounted invoice counts exactly once in forecast projections', async () => {
    const engine = await getEngine();
    const inv: Invoice = {
      id: 'inv_test_disc',
      number: 'INV-TEST-001',
      businessId: 'biz_001',
      payerId: 'pyr_001',
      amount: 350000, // $3,500.00 original nominal amount
      amountPaid: 0,
      issueDate: '2026-10-15',
      dueDate: '2026-11-04',
      status: 'SENT',
      discountPct: 2, // 2% discount applied -> $3,430.00
    };
    const pyr: Payer = {
      id: 'pyr_001',
      name: 'Test Payer',
      email: 'test@example.com',
      persona: 'reliable',
      avgDaysLate: 0,
      latenessRisk: 0,
    };

    // Before payment: expected receipt is exactly 343,000 cents (not discounted twice)
    const receiptsBefore = engine.expectedReceipts([inv], [pyr], '2026-11-05');
    expect(receiptsBefore).toHaveLength(1);
    expect(receiptsBefore[0].amount).toBe(343000);

    // After payment of 343,000 cents: remaining receipt is 0
    const invPaid: Invoice = {
      ...inv,
      amountPaid: 343000,
      status: 'PAID',
    };
    const receiptsAfter = engine.expectedReceipts([invPaid], [pyr], '2026-11-05');
    expect(receiptsAfter).toHaveLength(0);
  });

  // ── Task 1 & 5: Discount 2% then simulate-payment ─────────────────────────
  it('Task 1 & 5: discount 2% then pay -> amountPaid 343000, status PAID, cash +343000, shortfall 0', async () => {
    // 1. Reset baseline and provision PayPal
    await app.inject({ method: 'POST', url: '/api/demo/reset' });
    await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });

    const bizBefore = await businessRepo.get();
    expect(bizBefore?.startingBalance).toBe(980000); // $9,800.00

    const inv1 = (await invoiceRepo.getById('inv_001'))!;
    expect(inv1.amount).toBe(350000);
    expect(inv1.amountPaid).toBe(0);

    // 2. Execute OFFER_DISCOUNT of 2%
    const actionId = `act_disc_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: inv1.id,
      type: 'OFFER_DISCOUNT',
      params: { discountPct: 2 },
      reason: 'Offer 2% prompt-pay discount to bridge cash deficit',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(approveRes.statusCode).toBe(200);

    const invAfterDiscount = (await invoiceRepo.getById('inv_001'))!;
    expect(invAfterDiscount.discountPct).toBe(2);
    expect(invAfterDiscount.amount).toBe(350000); // Nominal stays 350,000

    // 3. Call POST /api/demo/simulate-payment { invoiceId: "inv_001" } without explicit amount
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_001' },
    });
    expect(payRes.statusCode).toBe(200);
    const payBody = JSON.parse(payRes.payload);
    expect(payBody.status).toBe('ok');
    expect(payBody.delta).toBe(343000);
    expect(payBody.newCashBalance).toBe(1323000); // 980000 + 343000 = 1323000

    // 4. Verify invoice state in DB
    const invAfterPay = (await invoiceRepo.getById('inv_001'))!;
    expect(invAfterPay.status).toBe('PAID');
    expect(invAfterPay.amountPaid).toBe(343000);
    expect(invAfterPay.amount).toBe(350000); // Original nominal amount preserved

    // 5. Verify cash balance and KPIs (shortfall is 0)
    const bizAfter = await businessRepo.get();
    expect(bizAfter?.startingBalance).toBe(1323000);

    const dashRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(dashRes.statusCode).toBe(200);
    const dash = JSON.parse(dashRes.payload);
    expect(dash.kpis.cash).toBe(1323000);
    expect(dash.kpis.shortfall).toBe(0);
    expect(dash.forecast.firstBreachDate).toBeNull();
  });

  // ── Task 1 & 5: Paying with amount above due is capped ─────────────────────
  it('Task 1 & 5: paying with an amount above the due amount is capped at due amount', async () => {
    // Reset data and provision
    await app.inject({ method: 'POST', url: '/api/demo/reset' });
    await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });

    const inv2 = (await invoiceRepo.getById('inv_002'))!; // 320,000 cents
    expect(inv2.amountPaid).toBe(0);

    // Call simulate-payment with explicit amount far above due amount ($10,000 = 1,000,000 cents)
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_002', amount: 1000000 },
    });
    expect(payRes.statusCode).toBe(200);
    const payBody = JSON.parse(payRes.payload);

    // Payment must be capped at 320,000 cents
    expect(payBody.delta).toBe(320000);
    expect(payBody.invoice.amountPaid).toBe(320000);
    expect(payBody.invoice.status).toBe('PAID');

    const inv2After = (await invoiceRepo.getById('inv_002'))!;
    expect(inv2After.amountPaid).toBe(320000);
    expect(inv2After.status).toBe('PAID');
  });

  // ── Task 1 & 5: Paying twice returns 409 NOTHING_DUE ───────────────────────
  it('Task 1 & 5: paying twice returns 409 NOTHING_DUE', async () => {
    // inv_002 is already fully paid from the previous test
    const payTwiceRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_002' },
    });

    expect(payTwiceRes.statusCode).toBe(409);
    const errBody = JSON.parse(payTwiceRes.payload);
    expect(errBody.error.code).toBe('NOTHING_DUE');
    expect(errBody.error.message).toMatch(/no outstanding balance/i);
  });

  // ── Task 2 & 5: PayPal error leaves DB unchanged and returns 502 ───────────
  it('Task 2 & 5: a PayPal error leaves invoice and cash unchanged and returns 502 with debugId', async () => {
    const bizBefore = (await businessRepo.get())!;
    const inv4Before = (await invoiceRepo.getById('inv_004'))!;

    // Enable failure simulation in fakePayPal
    fakePayPal.failOnRecordPayment = true;

    const failRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_004' },
    });

    expect(failRes.statusCode).toBe(502);
    const failBody = JSON.parse(failRes.payload);
    expect(failBody.error.code).toBe('PAYPAL_ERROR');
    expect(failBody.error.debugId).toBe('fake-debug-id-422');
    expect(failBody.error.message).toContain('PayPal payment rejected');

    // DB state must be untouched
    const bizAfter = (await businessRepo.get())!;
    expect(bizAfter.startingBalance).toBe(bizBefore.startingBalance);

    const inv4After = (await invoiceRepo.getById('inv_004'))!;
    expect(inv4After.amountPaid).toBe(inv4Before.amountPaid);
    expect(inv4After.status).toBe(inv4Before.status);

    // Disable failure
    fakePayPal.failOnRecordPayment = false;
  });

  // ── Task 5: Instalment children paid one by one credit cash correctly ─────
  it('Task 5: instalment children paid one by one credit cash correctly', async () => {
    // Reset data and provision
    await app.inject({ method: 'POST', url: '/api/demo/reset' });
    await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });

    const biz0 = (await businessRepo.get())!;
    const startCash = biz0.startingBalance; // 980,000
    const inv3 = (await invoiceRepo.getById('inv_003'))!;

    // Execute OFFER_INSTALMENTS on inv_003 (280,000 cents split into 2 payments: 140,000 each)
    const actionId = `act_inst_${Date.now()}`;
    const action: ActionRecord = {
      id: actionId,
      invoiceId: 'inv_003',
      type: 'OFFER_INSTALMENTS',
      params: { instalments: { count: 2, spacingDays: 14 } },
      reason: 'Two bi-weekly instalments',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    await actionRepo.insert(action);

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/actions/${actionId}/approve`,
    });
    expect(approveRes.statusCode).toBe(200);

    // Fetch child invoices
    const allInvoices = await invoiceRepo.list();
    const children = allInvoices.filter((i) => i.number.startsWith(`${inv3.number}-`));
    expect(children).toHaveLength(2);

    const child1 = children[0];
    const child2 = children[1];
    expect(child1.amount).toBe(140000);
    expect(child2.amount).toBe(140000);

    // Pay child 1
    const pay1Res = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: child1.id },
    });
    expect(pay1Res.statusCode).toBe(200);
    const pay1Body = JSON.parse(pay1Res.payload);
    expect(pay1Body.delta).toBe(140000);
    expect(pay1Body.newCashBalance).toBe(startCash + 140000);

    const child1After = (await invoiceRepo.getById(child1.id))!;
    expect(child1After.status).toBe('PAID');
    expect(child1After.amountPaid).toBe(140000);

    // Pay child 2
    const pay2Res = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: child2.id },
    });
    expect(pay2Res.statusCode).toBe(200);
    const pay2Body = JSON.parse(pay2Res.payload);
    expect(pay2Body.delta).toBe(140000);
    expect(pay2Body.newCashBalance).toBe(startCash + 280000);

    const child2After = (await invoiceRepo.getById(child2.id))!;
    expect(child2After.status).toBe('PAID');
    expect(child2After.amountPaid).toBe(140000);

    const bizFinal = (await businessRepo.get())!;
    expect(bizFinal.startingBalance).toBe(startCash + 280000);
  });

  // ── Task 4: Idempotent demo reconcile endpoint ────────────────────────────
  it('Task 4: POST /api/demo/reconcile re-syncs invoices from PayPal idempotently', async () => {
    const inv1 = (await invoiceRepo.getById('inv_001'))!;

    // 1. Initial reconcile syncs state
    const recSingle1 = await app.inject({
      method: 'POST',
      url: '/api/demo/reconcile',
      payload: { invoiceId: inv1.id },
    });
    expect(recSingle1.statusCode).toBe(200);

    // 2. Immediate re-reconcile of same invoice must be strictly idempotent (delta = 0)
    const recSingle2 = await app.inject({
      method: 'POST',
      url: '/api/demo/reconcile',
      payload: { invoiceId: inv1.id },
    });
    expect(recSingle2.statusCode).toBe(200);
    const bodySingle2 = JSON.parse(recSingle2.payload);
    expect(bodySingle2.status).toBe('ok');
    expect(bodySingle2.reconciled).toHaveLength(1);
    expect(bodySingle2.reconciled[0].delta).toBe(0);

    // 3. Reconcile all invoices twice to verify global idempotency
    const recAll1 = await app.inject({
      method: 'POST',
      url: '/api/demo/reconcile',
      payload: {},
    });
    expect(recAll1.statusCode).toBe(200);

    const recAll2 = await app.inject({
      method: 'POST',
      url: '/api/demo/reconcile',
      payload: {},
    });
    expect(recAll2.statusCode).toBe(200);
    const bodyAll2 = JSON.parse(recAll2.payload);
    expect(bodyAll2.status).toBe('ok');
    expect(bodyAll2.reconciled.length).toBeGreaterThan(0);
    // Every delta is 0 on repeated sync
    for (const r of bodyAll2.reconciled) {
      expect(r.delta).toBe(0);
    }
  });
});
