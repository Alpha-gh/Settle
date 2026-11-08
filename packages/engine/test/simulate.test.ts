import { describe, expect, it } from 'vitest';
import type { Business, ForecastInput, ExpectedReceipt, Obligation, ScenarioChange } from '@settle/shared';
import { simulate, formatMoney } from '../src/simulate.js';
import { EngineError } from '../src/errors.js';
import { applyDiscount } from '../src/money.js';
import { assertNoNaN, deepFreeze } from './helpers.js';

describe('simulate', () => {
  const baseBusiness: Business = {
    id: 'biz_01',
    name: 'Maya Studio',
    currency: 'USD',
    asOf: '2026-03-01',
    startingBalance: 1_000_000, // $10,000
    reserveThreshold: 500_000,  // $5,000
  };

  describe('rounding and money math verification', () => {
    it('3% on $1,999.99 (199,999 cents) -> 193,999 cents, cashCost 6,000', () => {
      const original = 199_999;
      const discounted = applyDiscount(original, 3);
      expect(discounted).toBe(193_999);
      expect(original - discounted).toBe(6_000);
    });

    it('tie case: 5% of 150 cents -> 143 cents (half-up), not 142', () => {
      // 150 * 0.95 = 142.5 -> rounds half-up to 143
      const original = 150;
      const discounted = applyDiscount(original, 5);
      expect(discounted).toBe(143);
    });

    it('formatMoney formats cents with commas and dollars via integer math', () => {
      expect(formatMoney(193_999)).toBe('$1,939.99');
      expect(formatMoney(100)).toBe('$1.00');
      expect(formatMoney(5)).toBe('$0.05');
      expect(formatMoney(0)).toBe('$0.00');
      expect(formatMoney(-500_000)).toBe('-$5,000.00');
    });
  });

  describe('instalment splitting logic', () => {
    it('allocates remainder cents to the first part and sums exactly to original for counts 2..6', () => {
      const amounts = [100, 101, 102, 103, 104, 105, 199_999, 1_000_000, 7];
      for (const amount of amounts) {
        for (let count = 2; count <= 6; count++) {
          const input: ForecastInput = {
            business: baseBusiness,
            obligations: [],
            receipts: [{ invoiceId: 'inv_inst', amount, date: '2026-03-05', confidence: 'expected' }],
            horizonDays: 60,
          };

          const result = simulate(input, {
            type: 'OFFER_INSTALMENTS',
            invoiceId: 'inv_inst',
            count,
            spacingDays: 7,
            firstDate: '2026-03-02',
          });

          assertNoNaN(result);
          expect(result.cashCost).toBe(0);
          expect(result.scenario.days).toBeDefined();

          // Check that sum of receipts across all days in scenario equals the original amount
          const totalReceiptsInScenario = result.scenario.days.reduce((sum, d) => sum + d.receipts, 0);
          expect(totalReceiptsInScenario).toBe(amount);
        }
      }
    });
  });

  describe('scenario changes', () => {
    it('REMIND: moves receipt date, updates confidence to expected, cashCost = 0', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [
          // Obligation of $8,000 on 2026-03-03 causes balance to drop to $2,000 (< reserve $5,000)
          { id: 'obl_1', label: 'Rent', kind: 'rent', amount: 800_000, dueDate: '2026-03-03' },
        ],
        receipts: [
          // Receipt was on 2026-03-05
          { invoiceId: 'inv_rem', amount: 600_000, date: '2026-03-05', confidence: 'expected' },
        ],
        horizonDays: 7,
      };

      // In baseline:
      // Day 1 (03-01): 10,000
      // Day 3 (03-03): 10,000 - 8,000 = 2,000 (breach!)
      // Day 5 (03-05): 2,000 + 6,000 = 8,000
      // Baseline lowest = 2,000; shortfall = 5,000 - 2,000 = 3,000; firstBreachDate = 2026-03-03

      // Move receipt to 2026-03-02 (before obligation)
      const res = simulate(input, {
        type: 'REMIND',
        invoiceId: 'inv_rem',
        newExpectedDate: '2026-03-02',
      });

      expect(res.cashCost).toBe(0);
      expect(res.baseline.firstBreachDate).toBe('2026-03-03');
      expect(res.scenario.firstBreachDate).toBeNull();
      expect(res.closesGap).toBe(true);
      expect(res.scenario.lowest.amount).toBe(800_000); // 10k + 6k - 8k = 8k >= 5k
      expect(res.lowestDelta).toBe(800_000 - 200_000); // +600,000
      expect(res.shortfallDelta).toBe(0 - 300_000);    // -300,000
      expect(res.assumptions.some((a) => a.includes('Assumes the payer pays on 2026-03-02 after the reminder'))).toBe(true);
      expect(res.assumptions.some((a) => a.includes('previously treated as expected on 2026-03-05'))).toBe(true);
      assertNoNaN(res);
    });

    it('OFFER_DISCOUNT: applies discount, computes cashCost, updates lowestDelta and closesGap', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [
          { id: 'obl_1', label: 'Supplier', kind: 'supplier', amount: 700_000, dueDate: '2026-03-03' },
        ],
        receipts: [
          { invoiceId: 'inv_disc', amount: 500_000, date: '2026-03-08', confidence: 'expected' },
        ],
        horizonDays: 10,
      };

      // Offer 3% discount to pay on 2026-03-02
      // 500_000 with 3% discount: 500_000 * 0.97 = 485_000
      // cashCost = 500_000 - 485_000 = 15_000
      const res = simulate(input, {
        type: 'OFFER_DISCOUNT',
        invoiceId: 'inv_disc',
        discountPct: 3,
        newExpectedDate: '2026-03-02',
      });

      expect(res.cashCost).toBe(15_000);
      expect(res.baseline.firstBreachDate).toBe('2026-03-03');
      // Scenario Day 1: 10,000
      // Day 2 (03-02): 10,000 + 4,850 = 14,850
      // Day 3 (03-03): 14,850 - 7,000 = 7,850 >= 5,000
      expect(res.scenario.firstBreachDate).toBeNull();
      expect(res.closesGap).toBe(true);
      expect(res.assumptions.some((a) => a.includes('$4,850.00'))).toBe(true);
    });

    it('OFFER_INSTALMENTS: splits receipt into parts, sets confidence expected, cashCost = 0', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [
          { invoiceId: 'inv_split', amount: 300_001, date: '2026-03-10', confidence: 'expected' },
        ],
        horizonDays: 20,
      };

      const res = simulate(input, {
        type: 'OFFER_INSTALMENTS',
        invoiceId: 'inv_split',
        count: 3,
        spacingDays: 5,
        firstDate: '2026-03-02',
      });

      expect(res.cashCost).toBe(0);
      expect(res.assumptions.some((a) => a.includes('3 instalments'))).toBe(true);
      // Remainder: 300_001 / 3 = 100_000 remainder 1.
      // Part 0 on 03-02: 100_001
      // Part 1 on 03-07: 100_000
      // Part 2 on 03-12: 100_000
      const day2 = res.scenario.days.find((d) => d.date === '2026-03-02');
      const day7 = res.scenario.days.find((d) => d.date === '2026-03-07');
      const day12 = res.scenario.days.find((d) => d.date === '2026-03-12');
      expect(day2?.receipts).toBe(100_001);
      expect(day7?.receipts).toBe(100_000);
      expect(day12?.receipts).toBe(100_000);
    });

    it('PURCHASE: adds outflow, can worsen lowest balance and cause breach', () => {
      const input: ForecastInput = {
        business: baseBusiness, // starting: 10,000, reserve: 5,000
        obligations: [],
        receipts: [],
        horizonDays: 5,
      };

      // Add a purchase of $6,000 on day 2
      const res = simulate(input, {
        type: 'PURCHASE',
        label: 'New Printer',
        amount: 600_000,
        date: '2026-03-02',
      });

      expect(res.cashCost).toBe(0);
      expect(res.baseline.firstBreachDate).toBeNull();
      expect(res.scenario.firstBreachDate).toBe('2026-03-02');
      // Baseline lowest = 10,000. Scenario lowest = 4,000.
      expect(res.lowestDelta).toBe(400_000 - 1_000_000); // -600,000
      expect(res.shortfallDelta).toBe(100_000 - 0);       // +100,000 (shortfall = 5,000 - 4,000 = 1,000)
      expect(res.closesGap).toBe(false);
      expect(res.assumptions.some((a) => a.includes('New Printer') && a.includes('$6,000.00'))).toBe(true);
    });

    it('uncertain -> expected promotes receipt into scenario visibility', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [
          { id: 'obl_1', label: 'Tax', kind: 'tax', amount: 800_000, dueDate: '2026-03-03' },
        ],
        receipts: [
          // Receipt is uncertain, so baseline (includeUncertain: false) ignores it!
          { invoiceId: 'inv_unc', amount: 500_000, date: '2026-03-02', confidence: 'uncertain' },
        ],
        horizonDays: 5,
      };

      // REMIND upgrades it to expected, so it becomes visible in the scenario!
      const res = simulate(input, {
        type: 'REMIND',
        invoiceId: 'inv_unc',
        newExpectedDate: '2026-03-02',
      });

      // Baseline excluded it: closing on day 3 is 10k - 8k = 2k (breach)
      expect(res.baseline.firstBreachDate).toBe('2026-03-03');
      // Scenario included it: closing on day 3 is 10k + 5k - 8k = 7k >= 5k (no breach)
      expect(res.scenario.firstBreachDate).toBeNull();
      expect(res.closesGap).toBe(true);
    });

    it('aggregates multiple receipts for the same invoice into one with an assumption note', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [
          { invoiceId: 'inv_multi', amount: 200_000, date: '2026-03-02', confidence: 'expected' },
          { invoiceId: 'inv_multi', amount: 300_000, date: '2026-03-04', confidence: 'expected' },
        ],
        horizonDays: 10,
      };

      const res = simulate(input, {
        type: 'REMIND',
        invoiceId: 'inv_multi',
        newExpectedDate: '2026-03-03',
      });

      expect(res.assumptions.some((a) => a.includes('2 separate receipts totaling $5,000.00'))).toBe(true);
      const day3 = res.scenario.days.find((d) => d.date === '2026-03-03');
      expect(day3?.receipts).toBe(500_000);
    });
  });

  describe('validation and error handling', () => {
    it('throws EngineError INVALID_INPUT for null input, null change, or unsupported change type', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [{ invoiceId: 'inv_1', amount: 100_000, date: '2026-03-02', confidence: 'expected' }],
        horizonDays: 5,
      };

      expect(() => simulate(null as unknown as ForecastInput, { type: 'REMIND', invoiceId: 'inv_1', newExpectedDate: '2026-03-02' })).toThrowError(EngineError);
      expect(() => simulate(input, null as unknown as ScenarioChange)).toThrowError(EngineError);
      expect(() => simulate(input, { type: 'UNKNOWN' } as unknown as ScenarioChange)).toThrowError(EngineError);
      expect(() => simulate(input, { type: 'REMIND', invoiceId: '', newExpectedDate: '2026-03-02' })).toThrowError(EngineError);
    });

    it('preserves other unrelated receipts when modifying a targeted invoice', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [
          { invoiceId: 'inv_1', amount: 100_000, date: '2026-03-02', confidence: 'expected' },
          { invoiceId: 'inv_2', amount: 200_000, date: '2026-03-04', confidence: 'expected' },
        ],
        horizonDays: 10,
      };

      const res = simulate(input, { type: 'REMIND', invoiceId: 'inv_1', newExpectedDate: '2026-03-03' });
      const day4 = res.scenario.days.find((d) => d.date === '2026-03-04');
      expect(day4?.receipts).toBe(200_000); // inv_2 was preserved!
    });

    it('throws EngineError NOT_FOUND if invoice has no receipt in input.receipts', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [],
        horizonDays: 5,
      };

      expect(() =>
        simulate(input, { type: 'REMIND', invoiceId: 'missing_inv', newExpectedDate: '2026-03-02' }),
      ).toThrowError(EngineError);

      try {
        simulate(input, { type: 'REMIND', invoiceId: 'missing_inv', newExpectedDate: '2026-03-02' });
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('NOT_FOUND');
      }
    });

    it('throws EngineError INVALID_INPUT for invalid discount percentages', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [{ invoiceId: 'inv_1', amount: 100_000, date: '2026-03-02', confidence: 'expected' }],
        horizonDays: 5,
      };

      const invalidPcts = [0, -5, 105, NaN, Infinity];
      for (const pct of invalidPcts) {
        expect(() =>
          simulate(input, { type: 'OFFER_DISCOUNT', invoiceId: 'inv_1', discountPct: pct, newExpectedDate: '2026-03-02' }),
        ).toThrowError(EngineError);
      }
    });

    it('throws EngineError INVALID_INPUT for invalid instalment counts or spacing', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [{ invoiceId: 'inv_1', amount: 100_000, date: '2026-03-02', confidence: 'expected' }],
        horizonDays: 5,
      };

      // Count < 2 or non-integer
      expect(() =>
        simulate(input, { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_1', count: 1, spacingDays: 7, firstDate: '2026-03-02' }),
      ).toThrowError(EngineError);
      expect(() =>
        simulate(input, { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_1', count: 2.5, spacingDays: 7, firstDate: '2026-03-02' }),
      ).toThrowError(EngineError);

      // SpacingDays < 1
      expect(() =>
        simulate(input, { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_1', count: 2, spacingDays: 0, firstDate: '2026-03-02' }),
      ).toThrowError(EngineError);
    });

    it('throws EngineError INVALID_INPUT for invalid purchase amounts or labels', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [],
        receipts: [],
        horizonDays: 5,
      };

      expect(() =>
        simulate(input, { type: 'PURCHASE', label: 'Item', amount: 0, date: '2026-03-02' }),
      ).toThrowError(EngineError);
      expect(() =>
        simulate(input, { type: 'PURCHASE', label: 'Item', amount: -100, date: '2026-03-02' }),
      ).toThrowError(EngineError);
      expect(() =>
        simulate(input, { type: 'PURCHASE', label: '', amount: 100, date: '2026-03-02' }),
      ).toThrowError(EngineError);
    });
  });

  describe('determinism and immutability', () => {
    it('is deterministic across multiple runs', () => {
      const input: ForecastInput = {
        business: baseBusiness,
        obligations: [{ id: 'o1', label: 'Rent', kind: 'rent', amount: 200_000, dueDate: '2026-03-03' }],
        receipts: [{ invoiceId: 'i1', amount: 300_000, date: '2026-03-04', confidence: 'expected' }],
        horizonDays: 7,
      };
      const change = { type: 'REMIND' as const, invoiceId: 'i1', newExpectedDate: '2026-03-02' };

      const run1 = simulate(input, change);
      const run2 = simulate(input, change);

      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });

    it('does not mutate input when deep-frozen', () => {
      const input: ForecastInput = deepFreeze({
        business: { ...baseBusiness },
        obligations: [{ id: 'o1', label: 'Rent', kind: 'rent', amount: 200_000, dueDate: '2026-03-03' }],
        receipts: [{ invoiceId: 'i1', amount: 300_000, date: '2026-03-04', confidence: 'expected' }],
        horizonDays: 7,
      });
      const change = deepFreeze({ type: 'REMIND' as const, invoiceId: 'i1', newExpectedDate: '2026-03-02' });

      expect(() => simulate(input, change)).not.toThrow();
    });
  });
});
