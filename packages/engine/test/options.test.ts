import { describe, expect, it } from 'vitest';
import type { ForecastInput, Invoice, Payer, Policy } from '@settle/shared';
import { generateOptions } from '../src/options.js';
import { deepFreeze } from './helpers.js';

describe('generateOptions', () => {
  const asOf = '2026-03-01';

  const baseInput: ForecastInput = {
    business: {
      id: 'biz_01',
      name: 'Maya Studio',
      currency: 'USD',
      asOf,
      startingBalance: 1_000_000,
      reserveThreshold: 500_000,
    },
    obligations: [],
    receipts: [],
    horizonDays: 30,
  };

  const defaultPolicy: Policy = {
    maxDiscountPct: 5,
    maxInstalments: 3,
    autoApproveMaxAmount: 500_000,
    requireApprovalFor: ['OFFER_DISCOUNT'],
    quietHours: { startHour: 20, endHour: 8 },
    maxRemindersPerInvoicePerWeek: 2,
  };

  const baseInvoice: Invoice = {
    id: 'inv_001',
    payerId: 'p_001',
    number: 'INV-100',
    description: 'Design Services',
    amount: 100_000,
    amountPaid: 0,
    issueDate: '2026-02-15',
    dueDate: '2026-03-05',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  };

  it('generates options for reliable payer: REMIND (asOf+2), discounts 2,3,5% (asOf+3), no instalments', () => {
    const payer: Payer = {
      id: 'p_rel',
      name: 'Reliable Payer',
      email: 'rel@example.com',
      persona: 'reliable',
      avgDaysLate: 2,
      latenessRisk: 0.1,
    };

    const options = generateOptions(baseInput, baseInvoice, payer, defaultPolicy);

    // Expected order: REMIND, discounts (2, 3, 5)
    expect(options).toEqual([
      { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-03-03' }, // asOf (03-01) + 2
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-03-04' }, // asOf + 3
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 3, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 5, newExpectedDate: '2026-03-04' },
    ]);
  });

  it('generates options for slow payer: REMIND (asOf+7), discounts 2,3,5% (asOf+3), instalments 2..3', () => {
    const payer: Payer = {
      id: 'p_slow',
      name: 'Slow Payer',
      email: 'slow@example.com',
      persona: 'slow',
      avgDaysLate: 10,
      latenessRisk: 0.4,
    };

    const options = generateOptions(baseInput, baseInvoice, payer, defaultPolicy);

    expect(options).toEqual([
      { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-03-08' }, // asOf (03-01) + 7
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 3, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 5, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_001', count: 2, spacingDays: 7, firstDate: '2026-03-04' },
      { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_001', count: 3, spacingDays: 7, firstDate: '2026-03-04' },
    ]);
  });

  it('generates options for chronic payer: REMIND (asOf+14), discounts 2,3,5%, instalments', () => {
    const payer: Payer = {
      id: 'p_chronic',
      name: 'Chronic Payer',
      email: 'chronic@example.com',
      persona: 'chronic',
      avgDaysLate: 25,
      latenessRisk: 0.8,
    };

    const options = generateOptions(baseInput, baseInvoice, payer, defaultPolicy);

    expect(options).toEqual([
      { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-03-15' }, // asOf (03-01) + 14
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 3, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 5, newExpectedDate: '2026-03-04' },
      { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_001', count: 2, spacingDays: 7, firstDate: '2026-03-04' },
      { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_001', count: 3, spacingDays: 7, firstDate: '2026-03-04' },
    ]);
  });

  it('ghost payer returns [] for escalation', () => {
    const payer: Payer = {
      id: 'p_ghost',
      name: 'Ghost Payer',
      email: 'ghost@example.com',
      persona: 'ghost',
      avgDaysLate: 60,
      latenessRisk: 1.0,
    };

    const options = generateOptions(baseInput, baseInvoice, payer, defaultPolicy);
    expect(options).toEqual([]);
  });

  it('drops discount options exceeding policy.maxDiscountPct (e.g. maxDiscountPct = 3 drops 5%)', () => {
    const payer: Payer = {
      id: 'p_rel',
      name: 'Reliable Payer',
      email: 'rel@example.com',
      persona: 'reliable',
      avgDaysLate: 2,
      latenessRisk: 0.1,
    };

    const policyWithCap3: Policy = { ...defaultPolicy, maxDiscountPct: 3 };
    const options = generateOptions(baseInput, baseInvoice, payer, policyWithCap3);

    const discountPcts = options
      .filter((o): o is Extract<typeof o, { type: 'OFFER_DISCOUNT' }> => o.type === 'OFFER_DISCOUNT')
      .map((o) => o.discountPct);

    expect(discountPcts).toEqual([2, 3]); // 5 is dropped
  });

  it('drops instalment options when policy.maxInstalments = 1', () => {
    const payer: Payer = {
      id: 'p_slow',
      name: 'Slow Payer',
      email: 'slow@example.com',
      persona: 'slow',
      avgDaysLate: 10,
      latenessRisk: 0.4,
    };

    const policyWith1Instalment: Policy = { ...defaultPolicy, maxInstalments: 1 };
    const options = generateOptions(baseInput, baseInvoice, payer, policyWith1Instalment);

    const instalments = options.filter((o) => o.type === 'OFFER_INSTALMENTS');
    expect(instalments).toHaveLength(0);
  });

  it('returns [] if the invoice is not open (PAID, DRAFT, CANCELLED, REFUNDED)', () => {
    const nonOpenStatuses: Invoice['status'][] = ['PAID', 'DRAFT', 'CANCELLED', 'REFUNDED'];
    const payer: Payer = {
      id: 'p_rel',
      name: 'Reliable Payer',
      email: 'rel@example.com',
      persona: 'reliable',
      avgDaysLate: 2,
      latenessRisk: 0.1,
    };

    for (const status of nonOpenStatuses) {
      const inv: Invoice = { ...baseInvoice, status };
      expect(generateOptions(baseInput, inv, payer, defaultPolicy)).toEqual([]);
    }
  });

  it('returns [] if the remaining balance on invoice is zero or negative', () => {
    const payer: Payer = {
      id: 'p_rel',
      name: 'Reliable Payer',
      email: 'rel@example.com',
      persona: 'reliable',
      avgDaysLate: 2,
      latenessRisk: 0.1,
    };

    // Fully paid
    const paidInv: Invoice = { ...baseInvoice, status: 'PARTIALLY_PAID', amount: 100_000, amountPaid: 100_000 };
    expect(generateOptions(baseInput, paidInv, payer, defaultPolicy)).toEqual([]);

    // Overpaid
    const overpaidInv: Invoice = { ...baseInvoice, status: 'PARTIALLY_PAID', amount: 100_000, amountPaid: 120_000 };
    expect(generateOptions(baseInput, overpaidInv, payer, defaultPolicy)).toEqual([]);
  });

  it('returns [] for unknown payer persona', () => {
    const unknownPayer: Payer = {
      id: 'p_unknown',
      name: 'Unknown',
      email: 'u@example.com',
      persona: 'unknown' as any,
      avgDaysLate: 0,
      latenessRisk: 0,
    };
    expect(generateOptions(baseInput, baseInvoice, unknownPayer, defaultPolicy)).toEqual([]);
  });

  it('is deterministic and does not mutate inputs', () => {
    const payer: Payer = deepFreeze({
      id: 'p_slow',
      name: 'Slow Payer',
      email: 'slow@example.com',
      persona: 'slow',
      avgDaysLate: 10,
      latenessRisk: 0.4,
    });
    const frozenInput = deepFreeze({ ...baseInput });
    const frozenInvoice = deepFreeze({ ...baseInvoice });
    const frozenPolicy = deepFreeze({ ...defaultPolicy });

    const run1 = generateOptions(frozenInput, frozenInvoice, payer, frozenPolicy);
    const run2 = generateOptions(frozenInput, frozenInvoice, payer, frozenPolicy);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
