import type { Kpis } from '@settle/shared';
import { mockObligations } from './obligations';

export const baselineKpis: Kpis = {
  cash: 980000, // $9,800.00
  overdueTotal: 1720000, // $17,200.00
  overdueCount: 8,
  avgDaysLate: 19,
  lowest: {
    date: '2026-11-06',
    amount: 300000, // $3,000.00
  },
  shortfall: 200000, // $2,000.00
  nextObligation: mockObligations[0],
};

export const afterPaymentKpis: Kpis = {
  cash: 1330000, // 980000 + 350000 = 1330000
  overdueTotal: 1370000, // 1720000 - 350000 = 1370000
  overdueCount: 7,
  avgDaysLate: 20,
  lowest: {
    date: '2026-11-06',
    amount: 632500,
  },
  shortfall: 0,
  nextObligation: mockObligations[0],
};

