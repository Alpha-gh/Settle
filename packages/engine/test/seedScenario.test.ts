import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ForecastInput, Snapshot } from '@settle/shared';
import { expectedReceipts } from '../src/expectedReceipts.js';
import { forecast } from '../src/forecast.js';
import { kpis } from '../src/kpis.js';
import { generateOptions } from '../src/options.js';
import { simulate } from '../src/simulate.js';
import { seedSnapshot } from '../test-support/seedScenario.js';
import { assertNoNaN } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('seedScenario', () => {
  const payrollDate = '2026-11-06';
  const collectionDate = '2026-11-04'; // payrollDate - 2

  it('baseline breaches the reserve at the payroll date (2026-11-06)', () => {
    const receipts = expectedReceipts(
      seedSnapshot.invoices,
      seedSnapshot.payers,
      seedSnapshot.business.asOf,
    );

    const input: ForecastInput = {
      business: seedSnapshot.business,
      obligations: seedSnapshot.obligations,
      receipts,
      horizonDays: 30,
      includeUncertain: false,
    };

    const res = forecast(input);
    expect(res.firstBreachDate).toBe(payrollDate);
    expect(res.lowest.date).toBe(payrollDate);
    expect(res.lowest.amount).toBe(-100_000); // -$1,000
    expect(res.shortfall).toBe(600_000);      // 500,000 - (-100,000) = $6,000
    assertNoNaN(res);
  });

  it('NO single one of the three largest overdue invoices collected on time closes the gap', () => {
    // Three largest overdue invoice IDs: 'inv_001', 'inv_002', 'inv_003'
    const topThreeIds = ['inv_001', 'inv_002', 'inv_003'];
    const baselineReceipts = expectedReceipts(
      seedSnapshot.invoices,
      seedSnapshot.payers,
      seedSnapshot.business.asOf,
    );

    for (const invId of topThreeIds) {
      const inv = seedSnapshot.invoices.find((i) => i.id === invId)!;
      // "Collected on time" = that invoice's receipt set to confidence 'expected' on payrollDate - 2
      const modifiedReceipts = baselineReceipts.filter((r) => r.invoiceId !== invId);
      modifiedReceipts.push({
        invoiceId: invId,
        amount: inv.amount,
        date: collectionDate,
        confidence: 'expected',
      });

      const res = forecast({
        business: seedSnapshot.business,
        obligations: seedSnapshot.obligations,
        receipts: modifiedReceipts,
        horizonDays: 30,
        includeUncertain: false,
      });

      // Still breaches at payroll!
      expect(res.firstBreachDate).toBe(payrollDate);
      expect(res.lowest.amount).toBeLessThan(seedSnapshot.business.reserveThreshold);
    }
  });

  it('ANY TWO of the three largest overdue invoices collected on time DO close the gap', () => {
    const topThreeIds = ['inv_001', 'inv_002', 'inv_003'] as const;
    const pairs: [string, string][] = [
      [topThreeIds[0], topThreeIds[1]],
      [topThreeIds[0], topThreeIds[2]],
      [topThreeIds[1], topThreeIds[2]],
    ];

    const baselineReceipts = expectedReceipts(
      seedSnapshot.invoices,
      seedSnapshot.payers,
      seedSnapshot.business.asOf,
    );

    for (const [idA, idB] of pairs) {
      const invA = seedSnapshot.invoices.find((i) => i.id === idA)!;
      const invB = seedSnapshot.invoices.find((i) => i.id === idB)!;

      const modifiedReceipts = baselineReceipts.filter(
        (r) => r.invoiceId !== idA && r.invoiceId !== idB,
      );

      modifiedReceipts.push({
        invoiceId: idA,
        amount: invA.amount,
        date: collectionDate,
        confidence: 'expected',
      });
      modifiedReceipts.push({
        invoiceId: idB,
        amount: invB.amount,
        date: collectionDate,
        confidence: 'expected',
      });

      const res = forecast({
        business: seedSnapshot.business,
        obligations: seedSnapshot.obligations,
        receipts: modifiedReceipts,
        horizonDays: 30,
        includeUncertain: false,
      });

      // Breach is completely closed across the entire 30-day horizon!
      expect(res.firstBreachDate).toBeNull();
      expect(res.shortfall).toBe(0);
      expect(res.lowest.amount).toBeGreaterThanOrEqual(seedSnapshot.business.reserveThreshold);
    }
  });

  it('kpis on the seed scenario asserts every field with hand-checkable numbers', () => {
    const k = kpis(seedSnapshot);

    // Starting cash
    expect(k.cash).toBe(1_200_000);

    // Overdue invoices: inv_001 ($3,500), inv_002 ($3,200), inv_003 ($3,000), inv_004 ($1,200)
    // 350k + 320k + 300k + 120k = 1,090,000 cents
    expect(k.overdueCount).toBe(4);
    expect(k.overdueTotal).toBe(1_090_000);

    // Days late:
    // inv_001: 2026-11-02 - 2026-10-15 = 18 days
    // inv_002: 2026-11-02 - 2026-10-26 = 7 days
    // inv_003: 2026-11-02 - 2026-10-20 = 13 days
    // inv_004: 2026-11-02 - 2026-10-10 = 23 days
    // Total = 18 + 7 + 13 + 23 = 61 days. Mean = 61 / 4 = 15.25 -> 15 (half-up)
    expect(k.avgDaysLate).toBe(15);

    // Lowest balance & shortfall from 30-day forecast
    expect(k.lowest).toEqual({ date: '2026-11-06', amount: -100_000 });
    expect(k.shortfall).toBe(600_000);

    // Next obligation: obl_supplier due 2026-11-04 is earliest >= asOf
    expect(k.nextObligation).toEqual(seedSnapshot.obligations[0]);
    assertNoNaN(k);
  });

  it('kpis edge cases: no overdue invoices and no future obligations', () => {
    const cleanSnapshot: Snapshot = {
      business: seedSnapshot.business,
      payers: seedSnapshot.payers,
      // Invoices due in the future
      invoices: [
        {
          id: 'inv_fut',
          payerId: 'pay_prompt',
          number: 'INV-FUT',
          description: 'Future',
          amount: 50_000,
          amountPaid: 0,
          issueDate: '2026-11-01',
          dueDate: '2026-11-20',
          status: 'SENT',
          discountPct: 0,
          allowPartial: false,
        },
      ],
      // Past obligations only
      obligations: [
        {
          id: 'obl_past',
          label: 'Old bill',
          kind: 'other',
          amount: 10_000,
          dueDate: '2026-10-01',
        },
      ],
      policy: seedSnapshot.policy,
    };

    const k = kpis(cleanSnapshot);
    expect(k.overdueCount).toBe(0);
    expect(k.overdueTotal).toBe(0);
    expect(k.avgDaysLate).toBe(0); // 0 when none, no NaN!
    expect(k.nextObligation).toBeUndefined(); // Omitted if none
    assertNoNaN(k);
  });

  const demoPath = path.resolve(__dirname, '../../../seed/demo.json');
  const hasDemo = existsSync(demoPath);

  it.skipIf(!hasDemo)('integration with seed/demo.json: breaches before payroll and intervention closes gap or lifts lowest', () => {
    const raw = readFileSync(demoPath, 'utf-8');
    const demoSnapshot = JSON.parse(raw) as Snapshot;

    const receipts = expectedReceipts(
      demoSnapshot.invoices,
      demoSnapshot.payers,
      demoSnapshot.business.asOf,
    );

    const input: ForecastInput = {
      business: demoSnapshot.business,
      obligations: demoSnapshot.obligations,
      receipts,
      horizonDays: 30,
      includeUncertain: false,
    };

    const baseline = forecast(input);
    const payrollObl = demoSnapshot.obligations.find((o) => o.kind === 'payroll');
    expect(payrollObl).toBeDefined();

    // Baseline breaches on or before payroll
    expect(baseline.firstBreachDate).not.toBeNull();
    expect(baseline.firstBreachDate! <= payrollObl!.dueDate).toBe(true);

    // Find the largest overdue invoice
    const overdueInvoices = demoSnapshot.invoices.filter(
      (inv) =>
        (inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID') &&
        inv.dueDate < demoSnapshot.business.asOf,
    );
    overdueInvoices.sort((a, b) => b.amount - a.amount);
    const largestOverdue = overdueInvoices[0]!;

    const payer = demoSnapshot.payers.find((p) => p.id === largestOverdue.payerId)!;
    const options = generateOptions(input, largestOverdue, payer, demoSnapshot.policy);
    expect(options.length).toBeGreaterThan(0);

    // At least one option closes the gap or moves lowest upward
    const simResults = options.map((opt) => simulate(input, opt));
    const effectiveOption = simResults.find(
      (sim) => sim.closesGap || sim.lowestDelta > 0,
    );
    expect(effectiveOption).toBeDefined();
    expect(effectiveOption!.lowestDelta).toBeGreaterThanOrEqual(0);
  });
});

