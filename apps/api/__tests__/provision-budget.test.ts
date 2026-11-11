import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Invoice, Payer, PayPalPort, Cents, ISODate, InvoiceStatus } from '@settle/shared';
import { buildApp } from '../src/app.js';
import { resetCachedEnv } from '../src/config/env.js';
import { closeDb } from '../src/db/index.js';
import { setupTestDatabase } from '../src/db/test-db.js';
import { InvoiceRepository } from '../src/db/repositories.js';

class SlowFakePayPal implements PayPalPort {
  public delayMs = 0;
  public inFlight = 0;
  public maxInFlight = 0;
  public createdByInvoiceId = new Map<string, string>();
  public preExistingByNumber = new Map<string, { paypalInvoiceId: string; payUrl: string }>();
  public createCalls: string[] = [];
  public lookupCalls: string[] = [];

  async findInvoiceByNumber(invoiceNumber: string) {
    this.lookupCalls.push(invoiceNumber);
    const existing = this.preExistingByNumber.get(invoiceNumber);
    if (!existing) return null;
    return {
      paypalInvoiceId: existing.paypalInvoiceId,
      payUrl: existing.payUrl,
      paypalInvoiceNumber: invoiceNumber,
      status: 'SENT',
    };
  }

  async createAndSendInvoice(
    inv: Invoice,
    _payer: Payer,
    options?: { invoiceNumber?: string; requestId?: string },
  ): Promise<{ paypalInvoiceId: string; payUrl: string; paypalInvoiceNumber?: string }> {
    this.inFlight++;
    if (this.inFlight > this.maxInFlight) {
      this.maxInFlight = this.inFlight;
    }
    this.createCalls.push(inv.id);
    try {
      if (this.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      const paypalInvoiceId = `PP-${inv.id}-${randomUUID().slice(0, 6)}`;
      const paypalInvoiceNumber = options?.invoiceNumber || inv.number;
      this.createdByInvoiceId.set(inv.id, paypalInvoiceId);
      return {
        paypalInvoiceId,
        payUrl: `https://www.sandbox.paypal.com/invoice/p/#${paypalInvoiceId}`,
        paypalInvoiceNumber,
      };
    } finally {
      this.inFlight--;
    }
  }

  async sendReminder(): Promise<void> {}
  async updateInvoice(): Promise<void> {}
  async cancelInvoice(): Promise<void> {}
  async getInvoice(): Promise<{ status: InvoiceStatus; amountPaid: Cents; total?: Cents; amountDue?: Cents }> {
    return { status: 'SENT', amountPaid: 0 };
  }
}

describe('PayPal Provisioning Budget, Concurrency, and Duplicate Prevention (Item 8)', () => {
  let app: FastifyInstance;
  let fakePayPal: SlowFakePayPal;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENGINE_IMPL = 'real';
    process.env.AGENT_IMPL = 'stub';
    process.env.AUTO_PROVISION_PAYPAL = 'false';
    process.env.PAYPAL_NUMBER_SUFFIX = 'false';
    process.env.PROVISION_BUDGET_SECONDS = '60';
    resetCachedEnv();

    await setupTestDatabase();
    fakePayPal = new SlowFakePayPal();
    app = await buildApp({ paypalClient: fakePayPal });
    await app.ready();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    process.env.PROVISION_BUDGET_SECONDS = '60';
    resetCachedEnv();
    if (app) {
      await app.close();
    }
    await closeDb();
  });

  it('respects PROVISION_BUDGET_SECONDS, reports remaining, and finishes cleanly on subsequent call', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    fakePayPal.delayMs = 120;
    fakePayPal.createCalls = [];
    process.env.PROVISION_BUDGET_SECONDS = '0.18';
    resetCachedEnv();

    const res1 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.payload);
    expect(body1.provisioned).toBeGreaterThanOrEqual(3);
    expect(body1.provisioned).toBeLessThan(12);
    expect(body1.remaining).toBe(12 - body1.provisioned);
    expect(body1.skipped).toBe(2);
    expect(body1.failed).toBe(0);

    // Second call with ample budget finishes only the remaining invoices
    fakePayPal.delayMs = 10;
    process.env.PROVISION_BUDGET_SECONDS = '10';
    resetCachedEnv();

    const res2 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.payload);
    expect(body2.provisioned).toBe(body1.remaining);
    expect(body2.skipped).toBe(2 + body1.provisioned);
    expect(body2.remaining).toBe(0);
    expect(body2.failed).toBe(0);
    expect(fakePayPal.createCalls).toHaveLength(12);
    expect(new Set(fakePayPal.createCalls).size).toBe(12);
  });

  it('runs provisioning with limited concurrency of 3', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    fakePayPal.delayMs = 60;
    fakePayPal.maxInFlight = 0;
    fakePayPal.createCalls = [];
    process.env.PROVISION_BUDGET_SECONDS = '10';
    resetCachedEnv();

    const res = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.provisioned).toBe(12);
    expect(body.remaining).toBe(0);
    expect(fakePayPal.maxInFlight).toBe(3);
  });

  it('prevents duplicates when saving fails after PayPal succeeds and looks up existing invoice by number before creating', async () => {
    await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    fakePayPal.delayMs = 0;
    fakePayPal.createCalls = [];
    fakePayPal.lookupCalls = [];
    fakePayPal.preExistingByNumber.clear();

    // Seed remote pre-existing PayPal invoice for INV-1002 (inv_002)
    fakePayPal.preExistingByNumber.set('INV-1002', {
      paypalInvoiceId: 'PP-PREEXISTING-INV2',
      payUrl: 'https://www.sandbox.paypal.com/invoice/p/#PP-PREEXISTING-INV2',
    });

    // Fail DB update once for inv_001 after PayPal createAndSendInvoice succeeded
    const origUpdate = InvoiceRepository.prototype.update;
    let failedInv1Once = false;
    const updateSpy = vi
      .spyOn(InvoiceRepository.prototype, 'update')
      .mockImplementation(async function (this: InvoiceRepository, id: string, patch: any) {
        if (id === 'inv_001' && !failedInv1Once) {
          failedInv1Once = true;
          throw new Error('Simulated DB write failure after PayPal succeeded');
        }
        return origUpdate.call(this, id, patch);
      });

    try {
      const res1 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.payload);
      expect(body1.failed).toBe(1);
      expect(body1.provisioned).toBe(11);
      expect(fakePayPal.lookupCalls).toContain('INV-1002');
      // inv_002 was adopted by number lookup so createAndSendInvoice was NOT called for inv_002
      expect(fakePayPal.createCalls).not.toContain('inv_002');

      const callsAfterFirst = [...fakePayPal.createCalls];

      // Retry provisioning: inv_001 should recover without calling createAndSendInvoice again!
      const res2 = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.payload);
      expect(body2.provisioned).toBe(1);
      expect(body2.failed).toBe(0);
      expect(body2.remaining).toBe(0);
      expect(fakePayPal.createCalls).toEqual(callsAfterFirst);
    } finally {
      updateSpy.mockRestore();
      fakePayPal.preExistingByNumber.clear();
    }
  });

  it('reset followed by provision completes all 12 SENT invoices cleanly', async () => {
    fakePayPal.delayMs = 0;
    fakePayPal.createCalls = [];
    process.env.PROVISION_BUDGET_SECONDS = '60';
    resetCachedEnv();

    const resetRes = await app.inject({ method: 'POST', url: '/api/demo/reset', payload: {} });
    expect(resetRes.statusCode).toBe(200);

    const provRes = await app.inject({ method: 'POST', url: '/api/demo/provision-paypal', payload: {} });
    expect(provRes.statusCode).toBe(200);
    const body = JSON.parse(provRes.payload);
    expect(body).toEqual({
      provisioned: 12,
      skipped: 2,
      failed: 0,
      remaining: 0,
      failures: [],
    });

    const dashRes = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(dashRes.statusCode).toBe(200);
    const dash = JSON.parse(dashRes.payload);
    const sentWithoutPayPal = dash.invoices.filter(
      (i: Invoice) => i.status === 'SENT' && !i.paypalInvoiceId,
    );
    expect(sentWithoutPayPal).toHaveLength(0);
  });
});
