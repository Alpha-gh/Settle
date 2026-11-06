import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/index.js';
import { EngineError } from '../src/errors.js';

describe('createEngine', () => {
  const engine = createEngine();

  it('implements forecast and returns valid result', () => {
    const res = engine.forecast({
      business: {
        id: 'biz_01',
        name: 'Test Biz',
        currency: 'USD',
        asOf: '2026-03-01',
        startingBalance: 100_000,
        reserveThreshold: 50_000,
      },
      obligations: [],
      receipts: [],
      horizonDays: 1,
    });

    expect(res.days).toHaveLength(1);
    expect(res.days[0]?.closing).toBe(100_000);
  });

  it('throws EngineError NOT_IMPLEMENTED for expectedReceipts', () => {
    expect(() => engine.expectedReceipts([], [], '2026-03-01')).toThrowError(EngineError);
    try {
      engine.expectedReceipts([], [], '2026-03-01');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('throws EngineError NOT_IMPLEMENTED for simulate', () => {
    const input = {
      business: {
        id: 'biz_01',
        name: 'Test Biz',
        currency: 'USD' as const,
        asOf: '2026-03-01',
        startingBalance: 100_000,
        reserveThreshold: 50_000,
      },
      obligations: [],
      receipts: [],
      horizonDays: 1,
    };
    expect(() => engine.simulate(input, { type: 'REMIND', invoiceId: 'inv_1', newExpectedDate: '2026-03-02' })).toThrowError(EngineError);
  });

  it('throws EngineError NOT_IMPLEMENTED for generateOptions', () => {
    const input = {
      business: {
        id: 'biz_01',
        name: 'Test Biz',
        currency: 'USD' as const,
        asOf: '2026-03-01',
        startingBalance: 100_000,
        reserveThreshold: 50_000,
      },
      obligations: [],
      receipts: [],
      horizonDays: 1,
    };
    const inv = {
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
    expect(() => engine.generateOptions(input, inv, payer, policy)).toThrowError(EngineError);
  });

  it('throws EngineError NOT_IMPLEMENTED for kpis', () => {
    const snapshot = {
      business: {
        id: 'biz_01',
        name: 'Test Biz',
        currency: 'USD' as const,
        asOf: '2026-03-01',
        startingBalance: 100_000,
        reserveThreshold: 50_000,
      },
      payers: [],
      invoices: [],
      obligations: [],
      policy: {
        maxDiscountPct: 5,
        maxInstalments: 3,
        autoApproveMaxAmount: 100_000,
        requireApprovalFor: [],
        quietHours: { startHour: 20, endHour: 8 },
        maxRemindersPerInvoicePerWeek: 1,
      },
    };
    expect(() => engine.kpis(snapshot)).toThrowError(EngineError);
  });
});

