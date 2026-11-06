import { describe, it, expect } from 'vitest';
import type { ForecastResult } from '@settle/shared';
import { mockBusiness } from './fixtures/business';
import {
  baselineForecast,
  afterPaymentForecast,
  mockScenarioComparison,
} from './fixtures/forecast';
import { generateDeterministicInvoices } from './fixtures/deterministicInvoices';
import { invoiceSchema } from '../api/schemas';

function verifyForecastIntegrity(
  forecast: ForecastResult,
  startingBalance: number,
  reserveThreshold: number,
) {
  const days = forecast.days;
  expect(days.length).toBe(30);

  // 1. Each day's closing equals previous closing + receipts - outflows
  let previousClosing = startingBalance;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const expectedClosing = previousClosing + day.receipts - day.outflows;
    expect(day.closing).toBe(expectedClosing);

    const expectedBelowReserve = day.closing < reserveThreshold;
    expect(day.belowReserve).toBe(expectedBelowReserve);

    previousClosing = day.closing;
  }

  // 2. Lowest amount and date agree with days
  let minAmount = Infinity;
  let minDate = '';
  for (const day of days) {
    if (day.closing < minAmount) {
      minAmount = day.closing;
      minDate = day.date;
    }
  }
  expect(forecast.lowest.amount).toBe(minAmount);
  expect(forecast.lowest.date).toBe(minDate);

  // 3. First breach date agrees with days
  const firstBreach = days.find((d) => d.belowReserve)?.date ?? null;
  expect(forecast.firstBreachDate).toBe(firstBreach);

  // 4. Shortfall agrees with max(0, reserveThreshold - lowest.amount)
  const expectedShortfall = Math.max(0, reserveThreshold - minAmount);
  expect(forecast.shortfall).toBe(expectedShortfall);
}

describe('Fixture Consistency Tests', () => {
  it('validates baseline forecast mathematical integrity', () => {
    verifyForecastIntegrity(
      baselineForecast,
      mockBusiness.startingBalance,
      mockBusiness.reserveThreshold,
    );
    expect(baselineForecast.shortfall).toBe(200000);
    expect(baselineForecast.firstBreachDate).toBe('2026-11-06');
    expect(baselineForecast.lowest.amount).toBe(300000);
  });

  it('validates afterPayment forecast mathematical integrity (breach gone)', () => {
    verifyForecastIntegrity(
      afterPaymentForecast,
      mockBusiness.startingBalance,
      mockBusiness.reserveThreshold,
    );
    expect(afterPaymentForecast.shortfall).toBe(0);
    expect(afterPaymentForecast.firstBreachDate).toBeNull();
    expect(afterPaymentForecast.lowest.amount).toBeGreaterThanOrEqual(
      mockBusiness.reserveThreshold,
    );
  });

  it('validates scenario comparisons agreement between baseline and scenario', () => {
    const comparison = mockScenarioComparison;
    const { baseline, scenario } = comparison;

    const expectedLowestDelta = scenario.lowest.amount - baseline.lowest.amount;
    const expectedShortfallDelta = baseline.shortfall - scenario.shortfall;
    const expectedClosesGap =
      scenario.firstBreachDate === null && baseline.firstBreachDate !== null;

    expect(comparison.lowestDelta).toBe(expectedLowestDelta);
    expect(comparison.shortfallDelta).toBe(expectedShortfallDelta);
    expect(comparison.closesGap).toBe(expectedClosesGap);
    expect(comparison.cashCost).toBe(17500); // 5% discount on 350000
  });

  it('validates deterministic invoices generator matches schema for 200 items', () => {
    const invoices = generateDeterministicInvoices(200);
    expect(invoices.length).toBe(200);

    // Validate a sample through zod invoice schema
    for (const inv of invoices.slice(0, 10)) {
      const parsed = invoiceSchema.safeParse(inv);
      expect(parsed.success).toBe(true);
    }
  });
});

