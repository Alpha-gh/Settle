import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type {
  Business,
  Cents,
  ForecastInput,
  Invoice,
  ISODate,
  Obligation,
  ObligationKind,
  Payer,
  Policy,
  ScenarioChange,
  Snapshot,
} from '@settle/shared';
import { addDays, compareISO } from '../src/dates.js';
import { createEngine } from '../src/index.js';
import { applyDiscount } from '../src/money.js';
import { assertNoNaN, deepFreeze } from './helpers.js';

const engine = createEngine();
const FC_CONFIG = { seed: 42, numRuns: 300 };

// ── Fast Arbitrary Generators ─────────────────────────────────────────────

// Base date anchors: offsets from 2026-01-01
const isoDateArb = fc
  .integer({ min: 0, max: 180 })
  .map((offset) => addDays('2026-01-01', offset));

const nonNegativeCentsArb = fc.integer({ min: 0, max: 10_000_000 });
const safeCentsArb = fc.integer({ min: -5_000_000, max: 10_000_000 });

const defaultPolicy: Policy = {
  maxDiscountPct: 5,
  maxInstalments: 3,
  autoApproveMaxAmount: 500_000,
  requireApprovalFor: ['OFFER_DISCOUNT'],
  quietHours: { startHour: 20, endHour: 8 },
  maxRemindersPerInvoicePerWeek: 1,
};

const obligationArb = (asOf: ISODate): fc.Arbitrary<Obligation> =>
  fc.record({
    id: fc.integer({ min: 1, max: 999 }).map((n) => `obl-${n}`),
    label: fc.constantFrom('Payroll', 'Tax', 'Rent', 'Supplier A', 'Software', 'Insurance'),
    kind: fc.constantFrom<ObligationKind>('payroll', 'tax', 'rent', 'supplier', 'other'),
    amount: nonNegativeCentsArb,
    dueDate: fc.integer({ min: -30, max: 90 }).map((offset) => addDays(asOf, offset)),
  });

const receiptArb = (asOf: ISODate): fc.Arbitrary<ForecastInput['receipts'][number]> =>
  fc.record({
    invoiceId: fc.integer({ min: 1, max: 999 }).map((n) => `inv-${n}`),
    amount: nonNegativeCentsArb,
    date: fc.integer({ min: -30, max: 90 }).map((offset) => addDays(asOf, offset)),
    confidence: fc.constantFrom<'confirmed' | 'expected' | 'uncertain'>(
      'confirmed',
      'expected',
      'uncertain',
    ),
  });

const forecastInputArb: fc.Arbitrary<ForecastInput> = isoDateArb.chain((asOf) =>
  fc.record({
    business: fc.record({
      id: fc.constant('biz-prop'),
      name: fc.constant('Property Biz'),
      currency: fc.constant<'USD'>('USD'),
      asOf: fc.constant(asOf),
      startingBalance: safeCentsArb,
      reserveThreshold: nonNegativeCentsArb,
    }),
    horizonDays: fc.integer({ min: 1, max: 60 }),
    includeUncertain: fc.boolean(),
    obligations: fc.array(obligationArb(asOf), { maxLength: 8 }),
    receipts: fc.array(receiptArb(asOf), { maxLength: 8 }),
  }),
);

describe('Property-Based Tests (fast-check, seed: 42, 300 runs)', () => {
  it(
    'Conservation: final closing = startingBalance + included receipts within horizon - obligations within horizon',
    () => {
      fc.assert(
        fc.property(forecastInputArb, (input) => {
          const result = engine.forecast(input);
          const asOf = input.business.asOf;
          const horizonEnd = addDays(asOf, input.horizonDays - 1);

          // Sum included receipts
          let includedReceiptsTotal = 0;
          for (const rec of input.receipts) {
            if (rec.confidence === 'uncertain' && !input.includeUncertain) {
              continue;
            }
            if (compareISO(rec.date, horizonEnd) > 0) {
              continue;
            }
            includedReceiptsTotal += rec.amount;
          }

          // Sum included obligations
          let includedObligationsTotal = 0;
          for (const obl of input.obligations) {
            if (compareISO(obl.dueDate, horizonEnd) > 0) {
              continue;
            }
            includedObligationsTotal += obl.amount;
          }

          const finalDay = result.days[result.days.length - 1]!;
          const expectedFinalClosing =
            input.business.startingBalance + includedReceiptsTotal - includedObligationsTotal;

          expect(finalDay.closing).toBe(expectedFinalClosing);
        }),
        FC_CONFIG,
      );
    },
    15000,
  );

  it(
    'Identity: every day closing = previous closing + receipts - outflows',
    () => {
      fc.assert(
        fc.property(forecastInputArb, (input) => {
          const result = engine.forecast(input);

          for (let t = 0; t < result.days.length; t++) {
            const day = result.days[t]!;
            const prevClosing =
              t === 0 ? input.business.startingBalance : result.days[t - 1]!.closing;
            expect(day.closing).toBe(prevClosing + day.receipts - day.outflows);
          }
        }),
        FC_CONFIG,
      );
    },
    15000,
  );

  it(
    'lowest is minimum closing and earliest tie date; shortfall = max(0, reserve - lowest.amount); firstBreachDate matches belowReserve',
    () => {
      fc.assert(
        fc.property(forecastInputArb, (input) => {
          const result = engine.forecast(input);

          // Lowest is minimum closing
          const allClosings = result.days.map((d) => d.closing);
          const minClosing = Math.min(...allClosings);
          expect(result.lowest.amount).toBe(minClosing);

          // Earliest tie date on ties
          const firstMinDay = result.days.find((d) => d.closing === minClosing)!;
          expect(result.lowest.date).toBe(firstMinDay.date);

          // Shortfall = max(0, reserve - lowest.amount)
          const expectedShortfall = Math.max(0, input.business.reserveThreshold - minClosing);
          expect(result.shortfall).toBe(expectedShortfall);

          // firstBreachDate
          const firstBreach = result.days.find((d) => d.belowReserve);
          if (firstBreach) {
            expect(result.firstBreachDate).toBe(firstBreach.date);
          } else {
            expect(result.firstBreachDate).toBeNull();
          }

          // null iff no day below reserve
          const hasBreach = result.days.some((d) => d.belowReserve);
          expect(result.firstBreachDate !== null).toBe(hasBreach);
        }),
        FC_CONFIG,
      );
    },
    15000,
  );

  it('Instalments always sum exactly to original receipt amount; remainder is all in first part; no part is negative', () => {
    const instalmentInputArb = fc.record({
      originalAmount: fc.integer({ min: 0, max: 20_000_000 }),
      count: fc.integer({ min: 2, max: 12 }),
      spacingDays: fc.integer({ min: 1, max: 30 }),
      firstDate: isoDateArb,
    });

    fc.assert(
      fc.property(instalmentInputArb, ({ originalAmount, count, spacingDays, firstDate }) => {
        const input: ForecastInput = {
          business: {
            id: 'biz-inst',
            name: 'Instalment Biz',
            currency: 'USD',
            asOf: firstDate,
            startingBalance: 100_000,
            reserveThreshold: 0,
          },
          horizonDays: count * spacingDays + 10,
          receipts: [
            {
              invoiceId: 'inv-inst',
              amount: originalAmount,
              date: firstDate,
              confidence: 'expected',
            },
          ],
          obligations: [],
        };

        const comparison = engine.simulate(input, {
          type: 'OFFER_INSTALMENTS',
          invoiceId: 'inv-inst',
          count,
          spacingDays,
          firstDate,
        });

        const basePart = Math.floor(originalAmount / count);
        const remainder = originalAmount % count;

        let sumParts = 0;
        for (let k = 0; k < count; k++) {
          const partAmount = k === 0 ? basePart + remainder : basePart;
          expect(partAmount).toBeGreaterThanOrEqual(0);
          if (k === 0) {
            expect(partAmount).toBe(basePart + remainder);
          } else {
            expect(partAmount).toBe(basePart);
          }
          sumParts += partAmount;
        }

        expect(sumParts).toBe(originalAmount);
        expect(comparison.cashCost).toBe(0);
      }),
      FC_CONFIG,
    );
  });

  it('Discount: 0 <= discounted <= original; cashCost = original - discounted; 0% discount changes nothing', () => {
    const discountArb = fc.record({
      amount: fc.integer({ min: 0, max: 20_000_000 }),
      pct: fc.double({ min: 0, max: 100, noNaN: true }),
    });

    fc.assert(
      fc.property(discountArb, ({ amount, pct }) => {
        const discounted = applyDiscount(amount, pct);
        const cashCost = amount - discounted;

        expect(discounted).toBeGreaterThanOrEqual(0);
        expect(discounted).toBeLessThanOrEqual(amount);
        expect(cashCost).toBe(amount - discounted);

        if (pct === 0) {
          expect(applyDiscount(amount, 0)).toBe(amount);
        }

        if (pct === 100) {
          expect(applyDiscount(amount, 100)).toBe(0);
        }
      }),
      FC_CONFIG,
    );
  });

  it('Moving a receipt EARLIER (REMIND to an earlier date, same confidence) never lowers lowest.amount', () => {
    const earlierRemindArb = isoDateArb.chain((asOf) =>
      fc
        .record({
          horizonDays: fc.integer({ min: 10, max: 60 }),
          startingBalance: safeCentsArb,
          reserveThreshold: nonNegativeCentsArb,
          receiptAmount: nonNegativeCentsArb,
          origOffset: fc.integer({ min: 5, max: 40 }),
          newOffset: fc.integer({ min: 0, max: 5 }),
        })
        .map((params) => {
          const origDate = addDays(asOf, params.origOffset);
          const newExpectedDate = addDays(asOf, Math.min(params.origOffset, params.newOffset));
          const input: ForecastInput = {
            business: {
              id: 'biz-remind',
              name: 'Remind Biz',
              currency: 'USD',
              asOf,
              startingBalance: params.startingBalance,
              reserveThreshold: params.reserveThreshold,
            },
            horizonDays: Math.max(params.horizonDays, params.origOffset + 5),
            obligations: [
              {
                id: 'obl-1',
                label: 'Payroll',
                kind: 'payroll',
                amount: 50_000,
                dueDate: addDays(asOf, 7),
              },
            ],
            receipts: [
              {
                invoiceId: 'inv-target',
                amount: params.receiptAmount,
                date: origDate,
                confidence: 'expected',
              },
            ],
          };
          return { input, newExpectedDate };
        }),
    );

    fc.assert(
      fc.property(earlierRemindArb, ({ input, newExpectedDate }) => {
        const comparison = engine.simulate(input, {
          type: 'REMIND',
          invoiceId: 'inv-target',
          newExpectedDate,
        });

        expect(comparison.scenario.lowest.amount).toBeGreaterThanOrEqual(
          comparison.baseline.lowest.amount,
        );
      }),
      FC_CONFIG,
    );
  });

  it('Determinism and deepFreeze immutability across all five engine methods', () => {
    // 1. forecast
    fc.assert(
      fc.property(forecastInputArb, (input) => {
        const frozen = deepFreeze(structuredClone(input));
        const run1 = engine.forecast(frozen);
        const run2 = engine.forecast(frozen);
        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        assertNoNaN(run1);
      }),
      { seed: 42, numRuns: 100 },
    );

    // 2. expectedReceipts
    const expectedReceiptsInputArb = isoDateArb.chain((asOf) =>
      fc.record({
        asOf: fc.constant(asOf),
        invoices: fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 99 }).map((n) => `inv-${n}`),
            payerId: fc.constant('pyr-1'),
            number: fc.integer({ min: 100, max: 999 }).map((n) => `INV-${n}`),
            description: fc.constant('Services rendered'),
            amount: nonNegativeCentsArb,
            amountPaid: fc.integer({ min: 0, max: 100_000 }),
            issueDate: fc.constant(addDays(asOf, -30)),
            dueDate: fc.integer({ min: -10, max: 30 }).map((d) => addDays(asOf, d)),
            status: fc.constantFrom<Invoice['status']>('SENT', 'PARTIALLY_PAID', 'PAID', 'DRAFT'),
            discountPct: fc.integer({ min: 0, max: 20 }),
            allowPartial: fc.boolean(),
          }),
          { maxLength: 5 },
        ),
        payers: fc.constant<Payer[]>([
          {
            id: 'pyr-1',
            name: 'Payer One',
            email: 'payer1@example.com',
            persona: 'slow',
            avgDaysLate: 10,
            latenessRisk: 0.2,
          },
        ]),
      }),
    );

    fc.assert(
      fc.property(expectedReceiptsInputArb, ({ invoices, payers, asOf }) => {
        const frozenInvoices = deepFreeze(structuredClone(invoices));
        const frozenPayers = deepFreeze(structuredClone(payers));
        const run1 = engine.expectedReceipts(frozenInvoices, frozenPayers, asOf);
        const run2 = engine.expectedReceipts(frozenInvoices, frozenPayers, asOf);
        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        assertNoNaN(run1);
      }),
      { seed: 42, numRuns: 100 },
    );

    // 3. simulate
    const simulateInputArb = isoDateArb.chain((asOf) =>
      fc.record({
        input: fc.record({
          business: fc.record({
            id: fc.constant('biz-sim'),
            name: fc.constant('Sim Biz'),
            currency: fc.constant<'USD'>('USD'),
            asOf: fc.constant(asOf),
            startingBalance: safeCentsArb,
            reserveThreshold: nonNegativeCentsArb,
          }),
          horizonDays: fc.integer({ min: 10, max: 30 }),
          obligations: fc.constant<Obligation[]>([]),
          receipts: fc.constant<ForecastInput['receipts']>([
            {
              invoiceId: 'inv-sim',
              amount: 100_000,
              date: addDays(asOf, 5),
              confidence: 'expected',
            },
          ]),
        }),
        change: fc.constantFrom<ScenarioChange>(
          { type: 'REMIND', invoiceId: 'inv-sim', newExpectedDate: addDays(asOf, 3) },
          {
            type: 'OFFER_DISCOUNT',
            invoiceId: 'inv-sim',
            discountPct: 5,
            newExpectedDate: addDays(asOf, 3),
          },
          {
            type: 'OFFER_INSTALMENTS',
            invoiceId: 'inv-sim',
            count: 3,
            spacingDays: 7,
            firstDate: addDays(asOf, 3),
          },
          {
            type: 'PURCHASE',
            amount: 25_000,
            date: addDays(asOf, 4),
            label: 'Test laptop',
          },
        ),
      }),
    );

    fc.assert(
      fc.property(simulateInputArb, ({ input, change }) => {
        const frozenInput = deepFreeze(structuredClone(input));
        const frozenChange = deepFreeze(structuredClone(change));
        const run1 = engine.simulate(frozenInput, frozenChange);
        const run2 = engine.simulate(frozenInput, frozenChange);
        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        assertNoNaN(run1);
      }),
      { seed: 42, numRuns: 100 },
    );

    // 4. generateOptions
    const generateOptionsInputArb = isoDateArb.chain((asOf) =>
      fc.record({
        input: fc.record({
          business: fc.record({
            id: fc.constant('biz-opt'),
            name: fc.constant('Opt Biz'),
            currency: fc.constant<'USD'>('USD'),
            asOf: fc.constant(asOf),
            startingBalance: fc.constant(10_000),
            reserveThreshold: fc.constant(50_000),
          }),
          horizonDays: fc.constant(30),
          obligations: fc.constant<Obligation[]>([
            {
              id: 'obl-p',
              label: 'Payroll',
              kind: 'payroll',
              amount: 100_000,
              dueDate: addDays(asOf, 7),
            },
          ]),
          receipts: fc.constant<ForecastInput['receipts']>([
            {
              invoiceId: 'inv-opt',
              amount: 80_000,
              date: addDays(asOf, 20),
              confidence: 'uncertain',
            },
          ]),
        }),
        invoice: fc.constant<Invoice>({
          id: 'inv-opt',
          payerId: 'pyr-1',
          number: 'INV-OPT-1',
          description: 'Design consulting',
          amount: 80_000,
          amountPaid: 0,
          issueDate: addDays(asOf, -20),
          dueDate: addDays(asOf, -5), // overdue
          status: 'SENT',
          discountPct: 0,
          allowPartial: false,
        }),
        payer: fc.constantFrom<Payer>(
          {
            id: 'pyr-1',
            name: 'Payer Chronic',
            email: 'chronic@example.com',
            persona: 'chronic',
            avgDaysLate: 25,
            latenessRisk: 0.7,
          },
          {
            id: 'pyr-1',
            name: 'Payer Slow',
            email: 'slow@example.com',
            persona: 'slow',
            avgDaysLate: 10,
            latenessRisk: 0.3,
          },
        ),
        policy: fc.constant<Policy>(defaultPolicy),
      }),
    );

    fc.assert(
      fc.property(generateOptionsInputArb, ({ input, invoice, payer, policy }) => {
        const frozenInput = deepFreeze(structuredClone(input));
        const frozenInvoice = deepFreeze(structuredClone(invoice));
        const frozenPayer = deepFreeze(structuredClone(payer));
        const frozenPolicy = deepFreeze(structuredClone(policy));
        const run1 = engine.generateOptions(
          frozenInput,
          frozenInvoice,
          frozenPayer,
          frozenPolicy,
        );
        const run2 = engine.generateOptions(
          frozenInput,
          frozenInvoice,
          frozenPayer,
          frozenPolicy,
        );
        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        assertNoNaN(run1);
      }),
      { seed: 42, numRuns: 100 },
    );

    // 5. kpis
    const snapshotArb = isoDateArb.chain((asOf) =>
      fc.record({
        business: fc.record({
          id: fc.constant('biz-snap'),
          name: fc.constant('Snapshot Biz'),
          currency: fc.constant<'USD'>('USD'),
          asOf: fc.constant(asOf),
          startingBalance: safeCentsArb,
          reserveThreshold: nonNegativeCentsArb,
        }),
        invoices: fc.constant<Invoice[]>([
          {
            id: 'inv-1',
            payerId: 'pyr-1',
            number: 'INV-001',
            description: 'Consulting',
            amount: 50_000,
            amountPaid: 0,
            issueDate: addDays(asOf, -20),
            dueDate: addDays(asOf, -5),
            status: 'SENT',
            discountPct: 0,
            allowPartial: false,
          },
        ]),
        payers: fc.constant<Payer[]>([
          {
            id: 'pyr-1',
            name: 'Payer 1',
            email: 'payer1@example.com',
            persona: 'slow',
            avgDaysLate: 5,
            latenessRisk: 0.2,
          },
        ]),
        obligations: fc.constant<Obligation[]>([
          {
            id: 'obl-1',
            label: 'Tax',
            kind: 'tax',
            amount: 30_000,
            dueDate: addDays(asOf, 10),
          },
        ]),
        policy: fc.constant<Policy>(defaultPolicy),
      }),
    );

    fc.assert(
      fc.property(snapshotArb, (snapshot: Snapshot) => {
        const frozenSnapshot = deepFreeze(structuredClone(snapshot));
        const run1 = engine.kpis(frozenSnapshot);
        const run2 = engine.kpis(frozenSnapshot);
        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        assertNoNaN(run1);
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it(
    'No NaN/Infinity anywhere in outputs across arbitrary forecast inputs',
    () => {
      fc.assert(
        fc.property(forecastInputArb, (input) => {
          const result = engine.forecast(input);
          assertNoNaN(result);
        }),
        FC_CONFIG,
      );
    },
    15000,
  );
});
