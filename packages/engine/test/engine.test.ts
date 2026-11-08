import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/index.js';
import { EngineError } from '../src/errors.js';

describe('createEngine', () => {
  const engine = createEngine();

  const baseInput = {
    business: {
      id: 'biz_01',
      name: 'Test Biz',
      currency: 'USD' as const,
      asOf: '2026-03-01',
      startingBalance: 100_000,
      reserveThreshold: 50_000,
    },
    obligations: [],
    receipts: [{ invoiceId: 'inv_1', amount: 10_000, date: '2026-03-05', confidence: 'expected' as const }],
    horizonDays: 10,
  };

  const invoice = {
    id: 'inv_1',
    payerId: 'p_1',
    number: 'INV-001',
    description: 'Test',
    amount: 10_000,
    amountPaid: 0,
    issueDate: '2026-02-01',
    dueDate: '2026-03-01',
    status: 'SENT' as const,
    discountPct: 0,
    allowPartial: false,
  };

  const payer = {
    id: 'p_1',
    name: 'Alice',
    email: 'alice@example.com',
    persona: 'reliable' as const,
    avgDaysLate: 0,
    latenessRisk: 0,
  };

  const policy = {
    maxDiscountPct: 5,
    maxInstalments: 3,
    autoApproveMaxAmount: 100_000,
    requireApprovalFor: ['OFFER_DISCOUNT' as const],
    quietHours: { startHour: 20, endHour: 8 },
    maxRemindersPerInvoicePerWeek: 1,
  };

  it('implements forecast and returns valid result', () => {
    const res = engine.forecast(baseInput);
    expect(res.days).toHaveLength(10);
    expect(res.days[0]?.closing).toBe(100_000);
  });

  it('implements expectedReceipts and returns calculated receipts', () => {
    const receipts = engine.expectedReceipts([invoice], [payer], '2026-03-01');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.amount).toBe(10_000);
  });

  it('implements simulate and returns comparison', () => {
    const sim = engine.simulate(baseInput, {
      type: 'REMIND',
      invoiceId: 'inv_1',
      newExpectedDate: '2026-03-02',
    });
    expect(sim.baseline).toBeDefined();
    expect(sim.scenario).toBeDefined();
    expect(sim.cashCost).toBe(0);
  });

  it('implements generateOptions and returns scenario changes', () => {
    const options = engine.generateOptions(baseInput, invoice, payer, policy);
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]?.type).toBe('REMIND');
  });

  it('implements kpis and returns calculated metrics', () => {
    const snapshot = {
      business: baseInput.business,
      payers: [payer],
      invoices: [invoice],
      obligations: [],
      policy,
    };
    const k = engine.kpis(snapshot);
    expect(k.cash).toBe(100_000);
    expect(k.overdueCount).toBe(0);
    expect(k.overdueTotal).toBe(0);
    expect(k.avgDaysLate).toBe(0);
    expect(k.lowest).toBeDefined();
    expect(k.shortfall).toBeDefined();
  });
});
