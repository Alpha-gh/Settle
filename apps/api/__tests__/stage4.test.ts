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
import { PayPalClient } from '../src/paypal/client.js';
import { resetCachedEnv } from '../src/config/env.js';
import { getDb } from '../src/db/index.js';
import { invoicePayPalIds } from '../src/db/schema.js';
import { isNotNull } from 'drizzle-orm';
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

    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const paypalInvoiceNumber = `${inv.number || 'INV'}-${suffix}`;
    return {
      paypalInvoiceId,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`,
      paypalInvoiceNumber,
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

  public customStates: Map<string, { status: InvoiceStatus; amountPaid: Cents }> = new Map();

  public setInvoiceState(paypalInvoiceId: string, status: InvoiceStatus, amountPaid: Cents) {
    this.customStates.set(paypalInvoiceId, { status, amountPaid });
  }

  async getInvoice(paypalInvoiceId: string): Promise<{ status: InvoiceStatus; amountPaid: Cents }> {
    if (this.customStates.has(paypalInvoiceId)) {
      return this.customStates.get(paypalInvoiceId)!;
    }
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

  it('11. PayPalClient: duplicate number on first try then success on retry', async () => {
    let draftAttempts = 0;
    const recordedInvoiceNumbers: string[] = [];

    const mockFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.endsWith('/v2/invoicing/invoices')) {
        draftAttempts++;
        const body = JSON.parse(String(init?.body));
        recordedInvoiceNumbers.push(body.detail.invoice_number);

        if (draftAttempts === 1) {
          return new Response(
            JSON.stringify({
              name: 'UNPROCESSABLE_ENTITY',
              message: 'The requested action could not be performed, semantically incorrect, or failed business validation.',
              debug_id: 'dbg_dup_123',
              details: [
                {
                  field: '/detail/invoice_number',
                  value: body.detail.invoice_number,
                  location: 'body',
                  issue: 'DUPLICATE_INVOICE_NUMBER',
                  description: 'Invoice number already exists',
                },
              ],
            }),
            {
              status: 422,
              headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'dbg_dup_123' },
            },
          );
        }

        return new Response(
          JSON.stringify({
            id: 'INV2-RETRY-SUCCESS-ID',
            detail: { invoice_number: body.detail.invoice_number },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('/send')) {
        return new Response(
          JSON.stringify({ href: 'https://www.sandbox.paypal.com/invoice/p/#INV2-RETRY-SUCCESS-ID' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new PayPalClient({
      clientId: 'mock-client',
      clientSecret: 'mock-secret',
      fetchFn: mockFetch,
      useNumberSuffix: true,
    });

    const inv: Invoice = {
      id: 'inv_test_retry',
      payerId: 'pyr_001',
      number: 'INV-1001',
      description: 'Test retry',
      amount: 10000,
      amountPaid: 0,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      status: 'SENT',
      discountPct: 0,
      allowPartial: false,
    };
    const payer: Payer = {
      id: 'pyr_001',
      name: 'Acme Corp',
      email: 'billing@acme.com',
      paymentTermsDays: 30,
      typicalDelayDays: 5,
    };

    const res = await client.createAndSendInvoice(inv, payer);
    expect(draftAttempts).toBe(2);
    expect(recordedInvoiceNumbers.length).toBe(2);
    expect(recordedInvoiceNumbers[0]).not.toBe(recordedInvoiceNumbers[1]);
    expect(recordedInvoiceNumbers[0]).toMatch(/^INV-1001-[0-9A-Z]{4}$/);
    expect(recordedInvoiceNumbers[1]).toMatch(/^INV-1001-[0-9A-Z]{4}$/);
    expect(res.paypalInvoiceId).toBe('INV2-RETRY-SUCCESS-ID');
    expect(res.paypalInvoiceNumber).toBe(recordedInvoiceNumbers[1]);
  });

  it('12. Two consecutive reset-and-provision runs both create 12 invoices, preserving history', async () => {
    // First reset & provision
    const resetRes1 = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(resetRes1.statusCode).toBe(200);

    const provRes1 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });
    expect(provRes1.statusCode).toBe(200);
    const provJson1 = JSON.parse(provRes1.payload);
    expect(provJson1.provisioned).toBe(12);
    expect(provJson1.failed).toBe(0);

    const db = getDb();
    const rows1 = await db.select().from(invoicePayPalIds);
    const activeRows1 = rows1.filter((r) => r.replacedAt === null);
    expect(activeRows1.length).toBe(12);

    // Second reset & provision
    const resetRes2 = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(resetRes2.statusCode).toBe(200);

    // After reset, all previous rows are marked replaced with reason "demo reset", none are deleted
    const rowsAfterReset = await db.select().from(invoicePayPalIds);
    expect(rowsAfterReset.length).toBeGreaterThanOrEqual(12);
    expect(rowsAfterReset.every((r) => r.replacedAt !== null)).toBe(true);

    const provRes2 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });
    expect(provRes2.statusCode).toBe(200);
    const provJson2 = JSON.parse(provRes2.payload);
    expect(provJson2.provisioned).toBe(12);
    expect(provJson2.failed).toBe(0);

    // Now 12 new active rows exist alongside the historical replaced rows
    const rows2 = await db.select().from(invoicePayPalIds);
    const activeRows2 = rows2.filter((r) => r.replacedAt === null);
    const replacedRows2 = rows2.filter((r) => r.replacedAt !== null);
    expect(activeRows2.length).toBe(12);
    expect(replacedRows2.length).toBe(rowsAfterReset.length);
  });

  it('13. Old webhooks after reset are ignored as superseded and never alter new data', async () => {
    process.env.WEBHOOK_VERIFY = 'false';
    resetCachedEnv();

    // Get an old replaced PayPal ID from the first run
    const db = getDb();
    const replaced = await db.select().from(invoicePayPalIds).where(isNotNull(invoicePayPalIds.replacedAt)).limit(1);
    expect(replaced.length).toBe(1);
    const oldPayPalInvoiceId = replaced[0].paypalInvoiceId;
    const oldInvoiceId = replaced[0].invoiceId;

    // Check current state of this invoice in the active DB
    const activeInvBefore = (await invoiceRepo.getById(oldInvoiceId))!;
    expect(activeInvBefore).toBeDefined();
    expect(activeInvBefore.status).toBe('SENT');

    // Send a CANCELLED webhook event for the old PayPal invoice ID
    const cancelWebhookRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paypal',
      payload: {
        id: `WH-OLD-CANCEL-${randomUUID()}`,
        event_type: 'INVOICING.INVOICE.CANCELLED',
        resource: {
          invoice: { id: oldPayPalInvoiceId },
        },
      },
    });
    expect(cancelWebhookRes.statusCode).toBe(200);
    const cancelJson = JSON.parse(cancelWebhookRes.payload);
    expect(cancelJson.handled).toBe(true);

    // Verify active invoice was NOT marked CANCELLED
    const activeInvAfterCancel = (await invoiceRepo.getById(oldInvoiceId))!;
    expect(activeInvAfterCancel.status).toBe('SENT');

    // Verify superseded audit event was recorded
    const audits = await auditRepo.list(20);
    const cancelAudit = audits.find(
      (a) => a.kind === 'invoice.superseded_cancelled' && a.detail?.paypalInvoiceId === oldPayPalInvoiceId,
    );
    expect(cancelAudit).toBeDefined();

    // Also send an UPDATED webhook event for the old PayPal invoice ID
    const updateWebhookRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paypal',
      payload: {
        id: `WH-OLD-UPDATE-${randomUUID()}`,
        event_type: 'INVOICING.INVOICE.UPDATED',
        resource: {
          invoice: { id: oldPayPalInvoiceId },
        },
      },
    });
    expect(updateWebhookRes.statusCode).toBe(200);
    const updateJson = JSON.parse(updateWebhookRes.payload);
    expect(updateJson.handled).toBe(true);

    const updateAudit = (await auditRepo.list(20)).find(
      (a) => a.kind === 'invoice.superseded_updated' && a.detail?.paypalInvoiceId === oldPayPalInvoiceId,
    );
    expect(updateAudit).toBeDefined();

    // Active invoice still unchanged
    const activeInvFinal = (await invoiceRepo.getById(oldInvoiceId))!;
    expect(activeInvFinal.status).toBe('SENT');
  });

  it('14. Cash balance synchronization: payment, duplicate, partial, refund, and reset', async () => {
    process.env.WEBHOOK_VERIFY = 'false';
    resetCachedEnv();

    // 1. Reset demo data to baseline
    const resetRes = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(resetRes.statusCode).toBe(200);

    const initialDashRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const initialDash = JSON.parse(initialDashRes.payload);
    expect(initialDash.business.startingBalance).toBe(980000);
    expect(initialDash.kpis.cash).toBe(980000);
    expect(initialDash.kpis.shortfall).toBe(200000);

    // 2. Provision invoices in PayPal
    const provRes = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal' });
    expect(provRes.statusCode).toBe(200);

    const inv1 = (await invoiceRepo.getById('inv_001'))!;
    expect(inv1.amount).toBe(350000);
    expect(inv1.amountPaid).toBe(0);
    expect(inv1.paypalInvoiceId).toBeDefined();

    // 3. Paying inv_001 in full sets cash to 1,330,000, shortfall 0 and firstBreachDate null
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_001' },
    });
    expect(payRes.statusCode).toBe(200);
    const payJson = JSON.parse(payRes.payload);
    expect(payJson.status).toBe('ok');
    expect(payJson.invoice.status).toBe('PAID');
    expect(payJson.invoice.amountPaid).toBe(350000);
    expect(payJson.forecast.shortfall).toBe(0);
    expect(payJson.forecast.firstBreachDate).toBeNull();

    // Verify stored business startingBalance and dashboard
    const dashAfterPayRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const dashAfterPay = JSON.parse(dashAfterPayRes.payload);
    expect(dashAfterPay.business.startingBalance).toBe(1330000);
    expect(dashAfterPay.kpis.cash).toBe(1330000);
    expect(dashAfterPay.kpis.shortfall).toBe(0);
    expect(dashAfterPay.forecast.shortfall).toBe(0);
    expect(dashAfterPay.forecast.firstBreachDate).toBeNull();

    // Verify audit event stating amount received and new cash balance
    const audits = await auditRepo.list(20);
    const payAudit = audits.find(
      (a) => a.invoiceId === 'inv_001' && (a.kind === 'invoice.paid' || a.kind === 'INVOICING.INVOICE.PAID'),
    );
    expect(payAudit).toBeDefined();
    expect(payAudit?.summary).toMatch(/3,?500\.00/);
    expect(payAudit?.summary).toMatch(/13,?300\.00/);
    expect(payAudit?.detail?.newCashBalance).toBe(1330000);

    // 4. Duplicate webhook or second reconcile adds nothing
    const dupWebhookRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paypal',
      payload: {
        id: `WH-DUP-${randomUUID()}`,
        event_type: 'INVOICING.INVOICE.PAID',
        resource: {
          invoice: { id: inv1.paypalInvoiceId },
        },
      },
    });
    expect(dupWebhookRes.statusCode).toBe(200);

    const dashAfterDup = JSON.parse((await app.inject({ method: 'GET', url: '/api/dashboard' })).payload);
    expect(dashAfterDup.business.startingBalance).toBe(1330000);
    expect(dashAfterDup.kpis.cash).toBe(1330000);

    // 5. Partial payment adds only the delta
    const inv2 = (await invoiceRepo.getById('inv_002'))!;
    expect(inv2.paypalInvoiceId).toBeDefined();
    expect(inv2.amountPaid).toBe(0);

    // First partial payment of 50,000 cents
    const partPayRes1 = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_002', amount: 50000 },
    });
    expect(partPayRes1.statusCode).toBe(200);

    const dashAfterPart1 = JSON.parse((await app.inject({ method: 'GET', url: '/api/dashboard' })).payload);
    expect(dashAfterPart1.business.startingBalance).toBe(1380000);
    expect(dashAfterPart1.kpis.cash).toBe(1380000);

    // Second partial payment of 30,000 cents (cumulative 80,000 cents, delta = +30,000)
    const partPayRes2 = await app.inject({
      method: 'POST',
      url: '/api/demo/simulate-payment',
      payload: { invoiceId: 'inv_002', amount: 30000 },
    });
    expect(partPayRes2.statusCode).toBe(200);

    const dashAfterPart2 = JSON.parse((await app.inject({ method: 'GET', url: '/api/dashboard' })).payload);
    expect(dashAfterPart2.business.startingBalance).toBe(1410000);
    expect(dashAfterPart2.kpis.cash).toBe(1410000);

    // 6. A refund subtracts
    // Simulate PayPal refunding inv_002 back to 0
    fakePayPal.setInvoiceState(inv2.paypalInvoiceId!, 'REFUNDED', 0);
    const refundWebhookRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paypal',
      payload: {
        id: `WH-REFUND-${randomUUID()}`,
        event_type: 'INVOICING.INVOICE.REFUNDED',
        resource: {
          invoice: { id: inv2.paypalInvoiceId },
        },
      },
    });
    expect(refundWebhookRes.statusCode).toBe(200);

    const dashAfterRefund = JSON.parse((await app.inject({ method: 'GET', url: '/api/dashboard' })).payload);
    // 1,410,000 - 80,000 = 1,330,000
    expect(dashAfterRefund.business.startingBalance).toBe(1330000);
    expect(dashAfterRefund.kpis.cash).toBe(1330000);

    const refundAudit = (await auditRepo.list(20)).find((a) => a.kind === 'INVOICING.INVOICE.REFUNDED');
    expect(refundAudit).toBeDefined();
    expect(refundAudit?.detail?.refundAmount).toBe(80000);
    expect(refundAudit?.detail?.newCashBalance).toBe(1330000);

    // 7. Reset restores 980,000
    const resetResFinal = await app.inject({ method: 'POST', url: '/api/demo/reset' });
    expect(resetResFinal.statusCode).toBe(200);

    const dashFinal = JSON.parse((await app.inject({ method: 'GET', url: '/api/dashboard' })).payload);
    expect(dashFinal.business.startingBalance).toBe(980000);
    expect(dashFinal.kpis.cash).toBe(980000);
    expect(dashFinal.kpis.shortfall).toBe(200000);
  });

});
