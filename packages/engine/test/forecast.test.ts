import { describe, expect, it } from 'vitest';
import type { Business, ForecastInput, Obligation, ExpectedReceipt } from '@settle/shared';
import { forecast } from '../src/forecast.js';
import { EngineError } from '../src/errors.js';
import { assertNoNaN, deepFreeze } from './helpers.js';

describe('forecast', () => {
  const baseBusiness: Business = {
    id: 'biz_001',
    name: 'Maya Studio',
    currency: 'USD',
    asOf: '2026-03-01',
    startingBalance: 4_000_000, // $40,000
    reserveThreshold: 1_000_000, // $10,000
  };

  it('GOLDEN: timing-not-totals demonstrates intermediate breach and shortfall', () => {
    // Start $40,000, reserve $10,000, supplier $25,000 on day 3, receipt $30,000 on day 5, $20,000 on day 1
    // Day 1 = 2026-03-01, Day 3 = 2026-03-03, Day 5 = 2026-03-05
    const obligations: Obligation[] = [
      { id: 'obl_1', label: 'Other Outflow', kind: 'other', amount: 2_000_000, dueDate: '2026-03-01' },
      { id: 'obl_2', label: 'Supplier Invoice', kind: 'supplier', amount: 2_500_000, dueDate: '2026-03-03' },
    ];
    const receipts: ExpectedReceipt[] = [
      { invoiceId: 'inv_1', amount: 3_000_000, date: '2026-03-05', confidence: 'confirmed' },
    ];

    const result = forecast({
      business: baseBusiness,
      obligations,
      receipts,
      horizonDays: 5,
    });

    expect(result.days).toHaveLength(5);
    // Day 1: 40k - 20k = 20k
    expect(result.days[0]?.closing).toBe(2_000_000);
    expect(result.days[0]?.belowReserve).toBe(false);

    // Day 2: 20k
    expect(result.days[1]?.closing).toBe(2_000_000);
    expect(result.days[1]?.belowReserve).toBe(false);

    // Day 3: 20k - 25k = -5k
    expect(result.days[2]?.closing).toBe(-500_000);
    expect(result.days[2]?.belowReserve).toBe(true);

    // Day 4: -5k
    expect(result.days[3]?.closing).toBe(-500_000);
    expect(result.days[3]?.belowReserve).toBe(true);

    // Day 5: -5k + 30k = 25k
    expect(result.days[4]?.closing).toBe(2_500_000);
    expect(result.days[4]?.belowReserve).toBe(false);

    // Totals end at $25,000, but lowest is -$5,000 on day 3
    expect(result.lowest).toEqual({ date: '2026-03-03', amount: -500_000 });
    // shortfall = max(0, 10_000 - (-5_000)) = 15_000 ($15,000)
    expect(result.shortfall).toBe(1_500_000);
    // firstBreachDate = day 3
    expect(result.firstBreachDate).toBe('2026-03-03');
    assertNoNaN(result);
  });

  it('GOLDEN: same case without the $20,000 outflow has no breach and picks earliest tie', () => {
    const obligations: Obligation[] = [
      { id: 'obl_2', label: 'Supplier Invoice', kind: 'supplier', amount: 2_500_000, dueDate: '2026-03-03' },
    ];
    const receipts: ExpectedReceipt[] = [
      { invoiceId: 'inv_1', amount: 3_000_000, date: '2026-03-05', confidence: 'confirmed' },
    ];

    const result = forecast({
      business: baseBusiness,
      obligations,
      receipts,
      horizonDays: 5,
    });

    // Closings:
    // Day 1: 40k
    // Day 2: 40k
    // Day 3: 15k
    // Day 4: 15k
    // Day 5: 45k
    expect(result.firstBreachDate).toBeNull();
    // Earliest tie date between day 3 and day 4 is day 3 ('2026-03-03')
    expect(result.lowest).toEqual({ date: '2026-03-03', amount: 1_500_000 });
    expect(result.shortfall).toBe(0);
    assertNoNaN(result);
  });

  it('clamps past receipts and obligations to asOf, and ignores items beyond horizon', () => {
    const obligations: Obligation[] = [
      // Past obligation due 2026-02-20 (before asOf 2026-03-01) -> clamped to 2026-03-01
      { id: 'obl_past', label: 'Past Rent', kind: 'rent', amount: 500_000, dueDate: '2026-02-20' },
      // Obligation beyond horizon 2026-03-10 -> ignored
      { id: 'obl_far', label: 'Far Tax', kind: 'tax', amount: 999_999, dueDate: '2026-03-10' },
    ];
    const receipts: ExpectedReceipt[] = [
      // Past receipt dated 2026-02-25 -> clamped to 2026-03-01
      { invoiceId: 'inv_past', amount: 200_000, date: '2026-02-25', confidence: 'confirmed' },
      // Receipt beyond horizon -> ignored
      { invoiceId: 'inv_far', amount: 888_888, date: '2026-03-20', confidence: 'confirmed' },
    ];

    const result = forecast({
      business: baseBusiness,
      obligations,
      receipts,
      horizonDays: 3, // Horizon: 2026-03-01 to 2026-03-03
    });

    expect(result.days).toHaveLength(3);
    // Day 1 (asOf): receipts 200k, outflows 500k
    // closing: 4_000_000 + 200_000 - 500_000 = 3_700_000
    expect(result.days[0]?.receipts).toBe(200_000);
    expect(result.days[0]?.outflows).toBe(500_000);
    expect(result.days[0]?.closing).toBe(3_700_000);

    // Day 2 and 3 have 0 receipts and 0 outflows because far items were ignored
    expect(result.days[1]?.receipts).toBe(0);
    expect(result.days[1]?.outflows).toBe(0);
    expect(result.days[2]?.receipts).toBe(0);
    expect(result.days[2]?.outflows).toBe(0);
    assertNoNaN(result);
  });

  it('excludes uncertain receipts by default and includes them when includeUncertain is true', () => {
    const receipts: ExpectedReceipt[] = [
      { invoiceId: 'inv_conf', amount: 100_000, date: '2026-03-02', confidence: 'confirmed' },
      { invoiceId: 'inv_unc', amount: 50_000, date: '2026-03-02', confidence: 'uncertain' },
    ];

    // Default: includeUncertain is false
    const defaultRes = forecast({
      business: baseBusiness,
      obligations: [],
      receipts,
      horizonDays: 3,
    });
    expect(defaultRes.days[1]?.receipts).toBe(100_000);

    // Explicit includeUncertain: false
    const excludedRes = forecast({
      business: baseBusiness,
      obligations: [],
      receipts,
      horizonDays: 3,
      includeUncertain: false,
    });
    expect(excludedRes.days[1]?.receipts).toBe(100_000);

    // Explicit includeUncertain: true
    const includedRes = forecast({
      business: baseBusiness,
      obligations: [],
      receipts,
      horizonDays: 3,
      includeUncertain: true,
    });
    expect(includedRes.days[1]?.receipts).toBe(150_000);
    assertNoNaN(includedRes);
  });

  it('handles empty obligations and receipts cleanly', () => {
    const result = forecast({
      business: baseBusiness,
      obligations: [],
      receipts: [],
      horizonDays: 3,
    });

    expect(result.days).toHaveLength(3);
    for (const d of result.days) {
      expect(d.receipts).toBe(0);
      expect(d.outflows).toBe(0);
      expect(d.closing).toBe(baseBusiness.startingBalance);
      expect(d.belowReserve).toBe(false);
    }
    expect(result.firstBreachDate).toBeNull();
    expect(result.lowest).toEqual({ date: '2026-03-01', amount: baseBusiness.startingBalance });
    expect(result.shortfall).toBe(0);
    assertNoNaN(result);
  });

  it('throws EngineError INVALID_INPUT for invalid horizonDays (0, -1, 2.5)', () => {
    const invalidHorizons = [0, -1, 2.5, -5, NaN, Infinity];

    for (const h of invalidHorizons) {
      expect(() =>
        forecast({
          business: baseBusiness,
          obligations: [],
          receipts: [],
          horizonDays: h as number,
        }),
      ).toThrowError(EngineError);

      try {
        forecast({
          business: baseBusiness,
          obligations: [],
          receipts: [],
          horizonDays: h as number,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    }
  });

  it('throws EngineError INVALID_INPUT for malformed inputs, dates, and amounts', () => {
    // Null input
    expect(() => forecast(null as any)).toThrowError(EngineError);

    // Missing business
    expect(() => forecast({ business: null as any, obligations: [], receipts: [], horizonDays: 5 })).toThrowError(EngineError);

    // Non-array obligations or receipts
    expect(() => forecast({ business: baseBusiness, obligations: 'not-array' as any, receipts: [], horizonDays: 5 })).toThrowError(EngineError);
    expect(() => forecast({ business: baseBusiness, obligations: [], receipts: 'not-array' as any, horizonDays: 5 })).toThrowError(EngineError);

    // Null obligation item or receipt item
    expect(() => forecast({ business: baseBusiness, obligations: [null as any], receipts: [], horizonDays: 5 })).toThrowError(EngineError);
    expect(() => forecast({ business: baseBusiness, obligations: [], receipts: [null as any], horizonDays: 5 })).toThrowError(EngineError);

    // Malformed asOf
    expect(() =>
      forecast({
        business: { ...baseBusiness, asOf: '2026-02-30' },
        obligations: [],
        receipts: [],
        horizonDays: 5,
      }),
    ).toThrowError(EngineError);

    // Malformed startingBalance
    expect(() =>
      forecast({
        business: { ...baseBusiness, startingBalance: 12.34 as unknown as number },
        obligations: [],
        receipts: [],
        horizonDays: 5,
      }),
    ).toThrowError(EngineError);

    // Negative obligation amount
    expect(() =>
      forecast({
        business: baseBusiness,
        obligations: [{ id: 'o1', label: 'neg', kind: 'other', amount: -100, dueDate: '2026-03-01' }],
        receipts: [],
        horizonDays: 5,
      }),
    ).toThrowError(EngineError);

    // Negative receipt amount
    expect(() =>
      forecast({
        business: baseBusiness,
        obligations: [],
        receipts: [{ invoiceId: 'i1', amount: -50, date: '2026-03-01', confidence: 'confirmed' }],
        horizonDays: 5,
      }),
    ).toThrowError(EngineError);

    // Invalid receipt confidence
    expect(() =>
      forecast({
        business: baseBusiness,
        obligations: [],
        receipts: [{ invoiceId: 'i1', amount: 50, date: '2026-03-01', confidence: 'maybe' as any }],
        horizonDays: 5,
      }),
    ).toThrowError(EngineError);
  });

  it('is completely deterministic: byte-identical JSON stringify across runs', () => {
    const input: ForecastInput = {
      business: baseBusiness,
      obligations: [
        { id: 'obl_1', label: 'Rent', kind: 'rent', amount: 200_000, dueDate: '2026-03-02' },
        { id: 'obl_2', label: 'Supplier', kind: 'supplier', amount: 450_000, dueDate: '2026-03-04' },
      ],
      receipts: [
        { invoiceId: 'inv_1', amount: 150_000, date: '2026-03-01', confidence: 'confirmed' },
        { invoiceId: 'inv_2', amount: 300_000, date: '2026-03-03', confidence: 'expected' },
        { invoiceId: 'inv_3', amount: 80_000, date: '2026-03-05', confidence: 'uncertain' },
      ],
      horizonDays: 7,
      includeUncertain: true,
    };

    const run1 = forecast(input);
    const run2 = forecast(input);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    assertNoNaN(run1);
    assertNoNaN(run2);
  });

  it('does not mutate inputs (deep-frozen input test)', () => {
    const input: ForecastInput = deepFreeze({
      business: { ...baseBusiness },
      obligations: [
        { id: 'obl_1', label: 'Payroll', kind: 'payroll', amount: 300_000, dueDate: '2026-03-02' },
      ],
      receipts: [
        { invoiceId: 'inv_1', amount: 500_000, date: '2026-03-03', confidence: 'confirmed' },
      ],
      horizonDays: 5,
      includeUncertain: false,
    });

    expect(() => forecast(input)).not.toThrow();
  });
});
