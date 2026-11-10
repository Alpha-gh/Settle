import type { ForecastResult, DayBalance, ScenarioComparison } from '@settle/shared';

export const FORECAST_DATES: string[] = [
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11',
  '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16',
  '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
  '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26',
  '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01',
];

// Baseline receipts and outflows for 30 days
// Starting balance = 980,000. Reserve = 500,000.
// On 2026-11-06 (Day 4): Outflow 1,200,000 (Payroll), Receipts 520,000 -> Closing 300,000 (Breach of 200,000).
export const baselineDays: DayBalance[] = [
  { date: '2026-11-02', receipts: 0, outflows: 0, closing: 980000, belowReserve: false },
  { date: '2026-11-03', receipts: 0, outflows: 0, closing: 980000, belowReserve: false },
  { date: '2026-11-04', receipts: 0, outflows: 0, closing: 980000, belowReserve: false },
  { date: '2026-11-05', receipts: 0, outflows: 0, closing: 980000, belowReserve: false },
  { date: '2026-11-06', receipts: 520000, outflows: 1200000, closing: 300000, belowReserve: true },
  { date: '2026-11-07', receipts: 0, outflows: 0, closing: 300000, belowReserve: true },
  { date: '2026-11-08', receipts: 0, outflows: 0, closing: 300000, belowReserve: true },
  { date: '2026-11-09', receipts: 300000, outflows: 0, closing: 600000, belowReserve: false },
  { date: '2026-11-10', receipts: 0, outflows: 0, closing: 600000, belowReserve: false },
  { date: '2026-11-11', receipts: 0, outflows: 0, closing: 600000, belowReserve: false },
  { date: '2026-11-12', receipts: 100000, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-13', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-14', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-15', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-16', receipts: 0, outflows: 150000, closing: 550000, belowReserve: false },
  { date: '2026-11-17', receipts: 50000, outflows: 0, closing: 600000, belowReserve: false },
  { date: '2026-11-18', receipts: 0, outflows: 0, closing: 600000, belowReserve: false },
  { date: '2026-11-19', receipts: 150000, outflows: 0, closing: 750000, belowReserve: false },
  { date: '2026-11-20', receipts: 0, outflows: 200000, closing: 550000, belowReserve: false },
  { date: '2026-11-21', receipts: 0, outflows: 0, closing: 550000, belowReserve: false },
  { date: '2026-11-22', receipts: 0, outflows: 0, closing: 550000, belowReserve: false },
  { date: '2026-11-23', receipts: 100000, outflows: 0, closing: 650000, belowReserve: false },
  { date: '2026-11-24', receipts: 0, outflows: 0, closing: 650000, belowReserve: false },
  { date: '2026-11-25', receipts: 0, outflows: 0, closing: 650000, belowReserve: false },
  { date: '2026-11-26', receipts: 50000, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-27', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-28', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-29', receipts: 0, outflows: 0, closing: 700000, belowReserve: false },
  { date: '2026-11-30', receipts: 100000, outflows: 0, closing: 800000, belowReserve: false },
  { date: '2026-12-01', receipts: 0, outflows: 0, closing: 800000, belowReserve: false },
];

export const baselineForecast: ForecastResult = {
  days: baselineDays,
  lowest: {
    date: '2026-11-06',
    amount: 300000,
  },
  firstBreachDate: '2026-11-06',
  shortfall: 200000,
};

// AfterPayment: Payment of $3,325.00 (332,500 cents) clears on 2026-11-06
// Closing on 2026-11-06 becomes 632,500 (above reserve threshold of 500,000)
// Every day from 2026-11-06 onwards has +332,500 added to closing.
export const afterPaymentDays: DayBalance[] = baselineDays.map((day, idx) => {
  if (idx < 4) {
    return { ...day };
  }
  if (idx === 4) {
    const receipts = day.receipts + 332500;
    const closing = day.closing + 332500;
    return {
      date: day.date,
      receipts,
      outflows: day.outflows,
      closing,
      belowReserve: false,
    };
  }
  return {
    date: day.date,
    receipts: day.receipts,
    outflows: day.outflows,
    closing: day.closing + 332500,
    belowReserve: false,
  };
});

export const afterPaymentForecast: ForecastResult = {
  days: afterPaymentDays,
  lowest: {
    date: '2026-11-06',
    amount: 632500,
  },
  firstBreachDate: null,
  shortfall: 0,
};

export const mockScenarioComparison: ScenarioComparison = {
  change: {
    type: 'OFFER_DISCOUNT',
    invoiceId: 'inv_001',
    discountPct: 5,
    newExpectedDate: '2026-11-06',
  },
  baseline: baselineForecast,
  scenario: afterPaymentForecast,
  lowestDelta: 332500, // 632500 - 300000
  shortfallDelta: 200000, // 200000 - 0
  cashCost: 17500, // 5% of 350000
  closesGap: true,
  assumptions: [
    'Bluefin Media accepts 5% early settlement discount',
    'Payment of $3,325.00 clears via PayPal by Friday 2026-11-06',
    'Completely eliminates the $2,000.00 payroll reserve shortfall',
  ],
};

