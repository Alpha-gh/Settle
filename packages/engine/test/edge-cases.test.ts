import { describe, expect, it } from 'vitest';
import type {
  Business,
  ForecastInput,
  Invoice,
  Payer,
  Policy,
  Snapshot,
} from '@settle/shared';
import { addDays, compareISO, diffDays, formatISO, parseISO } from '../src/dates.js';
import { EngineError } from '../src/errors.js';
import { createEngine } from '../src/index.js';
import { applyDiscount, assertCents, roundHalfUpDiv } from '../src/money.js';
import { assertNoNaN } from './helpers.js';

const engine = createEngine();

const validBusiness: Business = {
  id: 'biz_edge',
  name: 'Edge Case Testing Inc',
  currency: 'USD',
  asOf: '2026-11-01',
  startingBalance: 100_000,
  reserveThreshold: 50_000,
};

const validPolicy: Policy = {
  maxDiscountPct: 5,
  maxInstalments: 3,
  autoApproveMaxAmount: 500_000,
  requireApprovalFor: ['OFFER_DISCOUNT'],
  quietHours: { startHour: 20, endHour: 8 },
  maxRemindersPerInvoicePerWeek: 1,
};

describe('Edge Cases and Validation', () => {
  describe('Non-integer cents and unsafe integers', () => {
    it('rejects non-integer cents in startingBalance', () => {
      const input: any = {
        business: { ...validBusiness, startingBalance: 100.5 },
        horizonDays: 14,
        obligations: [],
        receipts: [],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
      try {
        engine.forecast(input);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
        expect((err as EngineError).message).toContain('safe integer');
      }
    });

    it('rejects non-integer cents in reserveThreshold', () => {
      const input: any = {
        business: { ...validBusiness, reserveThreshold: 50000.25 },
        horizonDays: 14,
        obligations: [],
        receipts: [],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
      try {
        engine.forecast(input);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });

    it('rejects non-integer cents in obligation amount', () => {
      const input: any = {
        business: validBusiness,
        horizonDays: 14,
        obligations: [{ id: 'obl-1', label: 'Rent', kind: 'rent', amount: 1200.5, dueDate: '2026-11-05' }],
        receipts: [],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
      try {
        engine.forecast(input);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });

    it('rejects non-integer cents in receipt amount', () => {
      const input: any = {
        business: validBusiness,
        horizonDays: 14,
        obligations: [],
        receipts: [{ invoiceId: 'inv-1', amount: 99.99, date: '2026-11-05', confidence: 'expected' }],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
      try {
        engine.forecast(input);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });

    it('rejects non-integer cents in PURCHASE change', () => {
      const input: ForecastInput = {
        business: validBusiness,
        horizonDays: 14,
        obligations: [],
        receipts: [],
      };
      expect(() =>
        engine.simulate(input, {
          type: 'PURCHASE',
          amount: 500.5 as any,
          date: '2026-11-05',
          label: 'Printer',
        }),
      ).toThrow(EngineError);
    });

    it('rejects unsafe integers (> MAX_SAFE_INTEGER and < MIN_SAFE_INTEGER)', () => {
      expect(() => assertCents(Number.MAX_SAFE_INTEGER + 10)).toThrow(EngineError);
      expect(() => assertCents(Number.MIN_SAFE_INTEGER - 10)).toThrow(EngineError);
      expect(() => assertCents(Infinity)).toThrow(EngineError);
      expect(() => assertCents(-Infinity)).toThrow(EngineError);
      expect(() => assertCents(NaN)).toThrow(EngineError);
    });
  });

  describe('Malformed dates', () => {
    it.each([
      ['2026-13-01', 'month 13'],
      ['26-1-1', 'short year and month'],
      ['', 'empty string'],
      ['2026-02-30', 'February 30th'],
      ['2026-04-31', 'April 31st (April has 30 days)'],
      ['2026-00-10', 'month 0'],
      ['2026-05-00', 'day 0'],
      ['2026-05-32', 'day 32'],
      ['not-a-date', 'arbitrary string'],
    ])('rejects malformed date "%s" (%s)', (dateStr) => {
      expect(() => parseISO(dateStr)).toThrow(EngineError);
      try {
        parseISO(dateStr);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }

      const input: any = {
        business: { ...validBusiness, asOf: dateStr },
        horizonDays: 7,
        obligations: [],
        receipts: [],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
    });

    it('rejects non-string values passed as dates', () => {
      expect(() => parseISO(null as any)).toThrow(EngineError);
      expect(() => parseISO(undefined as any)).toThrow(EngineError);
      expect(() => parseISO(12345 as any)).toThrow(EngineError);
      expect(() => parseISO({} as any)).toThrow(EngineError);
    });
  });

  describe('Horizon validation and horizon = 1', () => {
    it.each([
      [0, 'zero'],
      [-3, 'negative integer'],
      [1.5, 'non-integer float'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
    ])('rejects invalid horizonDays: %s (%s)', (horizonDays) => {
      const input: any = {
        business: validBusiness,
        horizonDays,
        obligations: [],
        receipts: [],
      };
      expect(() => engine.forecast(input)).toThrow(EngineError);
      try {
        engine.forecast(input);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });

    it('handles horizon = 1 correctly', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: 50000, reserveThreshold: 20000 },
        horizonDays: 1,
        obligations: [{ id: 'obl-1', label: 'Daily Fee', kind: 'other', amount: 5000, dueDate: '2026-11-01' }],
        receipts: [{ invoiceId: 'inv-1', amount: 15000, date: '2026-11-01', confidence: 'expected' }],
      };

      const result = engine.forecast(input);
      expect(result.days).toHaveLength(1);
      expect(result.days[0]).toEqual({
        date: '2026-11-01',
        receipts: 15000,
        outflows: 5000,
        closing: 60000,
        belowReserve: false,
      });
      expect(result.lowest).toEqual({ date: '2026-11-01', amount: 60000 });
      expect(result.shortfall).toBe(0);
      expect(result.firstBreachDate).toBeNull();
    });
  });

  describe('Empty arrays and edge cases', () => {
    it('handles empty obligations and receipts in forecast', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: 40000, reserveThreshold: 50000 },
        horizonDays: 5,
        obligations: [],
        receipts: [],
      };

      const result = engine.forecast(input);
      expect(result.days).toHaveLength(5);
      for (const d of result.days) {
        expect(d.receipts).toBe(0);
        expect(d.outflows).toBe(0);
        expect(d.closing).toBe(40000);
        expect(d.belowReserve).toBe(true);
      }
      expect(result.lowest).toEqual({ date: '2026-11-01', amount: 40000 });
      expect(result.shortfall).toBe(10000);
      expect(result.firstBreachDate).toBe('2026-11-01');
      assertNoNaN(result);
    });

    it('handles empty arrays in expectedReceipts', () => {
      const receipts = engine.expectedReceipts([], [], '2026-11-01');
      expect(receipts).toEqual([]);
    });

    it('handles empty snapshot in kpis without NaN or crashes', () => {
      const snapshot: Snapshot = {
        business: { ...validBusiness, startingBalance: 30000, reserveThreshold: 50000 },
        invoices: [],
        payers: [],
        obligations: [],
        policy: validPolicy,
      };

      const result = engine.kpis(snapshot);
      expect(result.cash).toBe(30000);
      expect(result.overdueTotal).toBe(0);
      expect(result.overdueCount).toBe(0);
      expect(result.avgDaysLate).toBe(0);
      expect(result.lowest).toEqual({ date: '2026-11-01', amount: 30000 });
      expect(result.shortfall).toBe(20000);
      expect(result.nextObligation).toBeUndefined();
      assertNoNaN(result);
    });
  });

  describe('Negative startingBalance (overdrawn business)', () => {
    it('calculates forecast correctly with negative starting balance', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: -50000, reserveThreshold: 10000 },
        horizonDays: 3,
        obligations: [{ id: 'obl-1', label: 'Rent', kind: 'rent', amount: 20000, dueDate: '2026-11-02' }],
        receipts: [{ invoiceId: 'inv-1', amount: 40000, date: '2026-11-03', confidence: 'expected' }],
      };

      const result = engine.forecast(input);
      expect(result.days[0]!.closing).toBe(-50000);
      expect(result.days[1]!.closing).toBe(-70000);
      expect(result.days[2]!.closing).toBe(-30000);
      expect(result.lowest).toEqual({ date: '2026-11-02', amount: -70000 });
      expect(result.shortfall).toBe(80000); // 10000 - (-70000) = 80000
      expect(result.firstBreachDate).toBe('2026-11-01');
      assertNoNaN(result);
    });
  });

  describe('Boundary dates: on asOf, on last horizon day, day after horizon, and past dates', () => {
    it('properly includes or excludes boundary obligations and receipts', () => {
      const asOf = '2026-11-01';
      const lastDay = '2026-11-05'; // horizon 5 days: 11-01, 11-02, 11-03, 11-04, 11-05
      const dayAfter = '2026-11-06';
      const pastDay = '2026-10-25';

      const input: ForecastInput = {
        business: { ...validBusiness, asOf, startingBalance: 100000, reserveThreshold: 0 },
        horizonDays: 5,
        obligations: [
          { id: 'obl-past', label: 'Past', kind: 'supplier', amount: 1000, dueDate: pastDay }, // clamped to asOf
          { id: 'obl-asof', label: 'AsOf', kind: 'supplier', amount: 2000, dueDate: asOf },
          { id: 'obl-last', label: 'Last', kind: 'supplier', amount: 4000, dueDate: lastDay },
          { id: 'obl-after', label: 'After', kind: 'supplier', amount: 8000, dueDate: dayAfter }, // excluded
        ],
        receipts: [
          { invoiceId: 'inv-past', amount: 500, date: pastDay, confidence: 'expected' }, // clamped to asOf
          { invoiceId: 'inv-asof', amount: 1500, date: asOf, confidence: 'expected' },
          { invoiceId: 'inv-last', amount: 3500, date: lastDay, confidence: 'expected' },
          { invoiceId: 'inv-after', amount: 7500, date: dayAfter, confidence: 'expected' }, // excluded
        ],
      };

      const result = engine.forecast(input);
      // Day 0: 2026-11-01 should have past (clamped) + asof
      expect(result.days[0]!.outflows).toBe(1000 + 2000);
      expect(result.days[0]!.receipts).toBe(500 + 1500);

      // Day 4: 2026-11-05 should have lastDay
      expect(result.days[4]!.outflows).toBe(4000);
      expect(result.days[4]!.receipts).toBe(3500);

      // Total outflows across horizon should NOT include dayAfter (8000)
      const totalOutflows = result.days.reduce((s, d) => s + d.outflows, 0);
      expect(totalOutflows).toBe(1000 + 2000 + 4000);

      // Total receipts across horizon should NOT include dayAfter (7500)
      const totalReceipts = result.days.reduce((s, d) => s + d.receipts, 0);
      expect(totalReceipts).toBe(500 + 1500 + 3500);
    });
  });

  describe('Leap year 2028 and non-leap years', () => {
    it('handles leap day 2028-02-29 correctly', () => {
      const leapDay = parseISO('2028-02-29');
      expect(formatISO(leapDay)).toBe('2028-02-29');

      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
      expect(diffDays('2028-03-01', '2028-02-28')).toBe(2);

      const input: ForecastInput = {
        business: { ...validBusiness, asOf: '2028-02-28', startingBalance: 50000, reserveThreshold: 0 },
        horizonDays: 3,
        obligations: [{ id: 'obl-leap', label: 'Leap Fee', kind: 'tax', amount: 10000, dueDate: '2028-02-29' }],
        receipts: [{ invoiceId: 'inv-leap', amount: 20000, date: '2028-03-01', confidence: 'expected' }],
      };

      const result = engine.forecast(input);
      expect(result.days[0]!.date).toBe('2028-02-28');
      expect(result.days[1]!.date).toBe('2028-02-29');
      expect(result.days[1]!.outflows).toBe(10000);
      expect(result.days[2]!.date).toBe('2028-03-01');
      expect(result.days[2]!.receipts).toBe(20000);
    });

    it('rejects 2026-02-29 and 2027-02-29 in non-leap years', () => {
      expect(() => parseISO('2026-02-29')).toThrow(EngineError);
      expect(() => parseISO('2027-02-29')).toThrow(EngineError);
    });
  });

  describe('Month and year rollovers', () => {
    it('rolls over month cleanly', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    });

    it('rolls over year cleanly', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(diffDays('2027-01-02', '2026-12-30')).toBe(3);

      const input: ForecastInput = {
        business: { ...validBusiness, asOf: '2026-12-30', startingBalance: 10000, reserveThreshold: 0 },
        horizonDays: 4,
        obligations: [],
        receipts: [],
      };

      const result = engine.forecast(input);
      expect(result.days.map((d) => d.date)).toEqual([
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
        '2027-01-02',
      ]);
    });
  });

  describe('Ghost receipt and horizon > 90', () => {
    it('excludes ghost receipt when includeUncertain is false, includes when true on horizon > 90', () => {
      const asOf = '2026-01-01';
      const ghostPayer: Payer = {
        id: 'pyr-ghost',
        name: 'Ghost Corp',
        email: 'ghost@example.com',
        persona: 'ghost',
        avgDaysLate: 0,
        latenessRisk: 1.0,
      };
      const invoice: Invoice = {
        id: 'inv-ghost',
        payerId: 'pyr-ghost',
        number: 'INV-GHOST-1',
        description: 'Ghost invoice',
        amount: 80000,
        amountPaid: 0,
        issueDate: '2025-12-01',
        dueDate: '2025-12-31',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      };

      const expected = engine.expectedReceipts([invoice], [ghostPayer], asOf);
      expect(expected).toHaveLength(1);
      expect(expected[0]).toEqual({
        invoiceId: 'inv-ghost',
        amount: 80000,
        date: addDays(asOf, 90), // asOf + 90
        confidence: 'uncertain',
      });

      // Forecast with horizon 100
      const baseInput: ForecastInput = {
        business: { ...validBusiness, asOf, startingBalance: 10000, reserveThreshold: 0 },
        horizonDays: 100,
        obligations: [],
        receipts: expected,
      };

      // 1. includeUncertain = false (default)
      const resWithoutUncertain = engine.forecast({ ...baseInput, includeUncertain: false });
      const day90Without = resWithoutUncertain.days[90]!;
      expect(day90Without.receipts).toBe(0);

      // 2. includeUncertain = true
      const resWithUncertain = engine.forecast({ ...baseInput, includeUncertain: true });
      const day90With = resWithUncertain.days[90]!;
      expect(day90With.receipts).toBe(80000);
      expect(day90With.closing).toBe(baseInput.business.startingBalance + 80000);
    });
  });

  describe('Duplicate receipts for one invoice', () => {
    it('forecast correctly aggregates duplicate receipts for one invoice on different or same dates', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: 10000, reserveThreshold: 0 },
        horizonDays: 5,
        obligations: [],
        receipts: [
          { invoiceId: 'inv-dup', amount: 20000, date: '2026-11-02', confidence: 'expected' },
          { invoiceId: 'inv-dup', amount: 30000, date: '2026-11-02', confidence: 'expected' },
          { invoiceId: 'inv-dup', amount: 40000, date: '2026-11-03', confidence: 'expected' },
        ],
      };

      const result = engine.forecast(input);
      expect(result.days[1]!.receipts).toBe(50000);
      expect(result.days[2]!.receipts).toBe(40000);
    });

    it('simulate combines multiple receipts for the same invoice, notes it in assumptions, and processes change', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: 10000, reserveThreshold: 0 },
        horizonDays: 10,
        obligations: [],
        receipts: [
          { invoiceId: 'inv-multi', amount: 30000, date: '2026-11-04', confidence: 'uncertain' },
          { invoiceId: 'inv-multi', amount: 20000, date: '2026-11-06', confidence: 'expected' },
        ],
      };

      const comparison = engine.simulate(input, {
        type: 'REMIND',
        invoiceId: 'inv-multi',
        newExpectedDate: '2026-11-03',
      });

      expect(comparison.assumptions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('had 2 separate receipts totaling $500.00; treated as one combined receipt'),
        ]),
      );

      // In scenario, the combined 50000 receipt moves to 2026-11-03 as 'expected'
      const scenDay2 = comparison.scenario.days[2]!; // 2026-11-03
      expect(scenDay2.receipts).toBe(50000);
      // Days 3 and 5 should have 0 receipts in scenario
      expect(comparison.scenario.days[3]!.receipts).toBe(0);
      expect(comparison.scenario.days[5]!.receipts).toBe(0);
    });
  });

  describe('EngineError messages and codes', () => {
    it('throws NOT_FOUND when simulate targets a non-existent invoiceId', () => {
      const input: ForecastInput = {
        business: { ...validBusiness, startingBalance: 10000, reserveThreshold: 0 },
        horizonDays: 5,
        obligations: [],
        receipts: [{ invoiceId: 'inv-1', amount: 10000, date: '2026-11-02', confidence: 'expected' }],
      };

      expect(() =>
        engine.simulate(input, {
          type: 'REMIND',
          invoiceId: 'inv-nonexistent',
          newExpectedDate: '2026-11-02',
        }),
      ).toThrow(EngineError);

      try {
        engine.simulate(input, {
          type: 'REMIND',
          invoiceId: 'inv-nonexistent',
          newExpectedDate: '2026-11-02',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('NOT_FOUND');
        expect((err as EngineError).message).toContain('inv-nonexistent');
      }
    });

    it('throws NOT_FOUND when expectedReceipts encounters an invoice with missing payer', () => {
      const invoice: Invoice = {
        id: 'inv-lost',
        payerId: 'pyr-missing',
        number: 'INV-LOST',
        description: 'Lost payer',
        amount: 50000,
        amountPaid: 0,
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      };

      expect(() => engine.expectedReceipts([invoice], [], '2026-11-01')).toThrow(EngineError);

      try {
        engine.expectedReceipts([invoice], [], '2026-11-01');
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('NOT_FOUND');
        expect((err as EngineError).message).toContain('inv-lost');
      }
    });
  });
});
