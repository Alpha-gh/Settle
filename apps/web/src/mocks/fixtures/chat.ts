import type { ChatAnswer } from '@settle/shared';
import { baselineForecast, mockScenarioComparison } from './forecast';

export const CANNED_CHAT_PROMPTS = {
  payroll: 'Can I cover payroll on Friday?',
  stock: 'What if I buy $3,000 of stock on Monday?',
  chase: 'Which invoice should I chase first?',
} as const;

export const cannedChatAnswers: Record<string, ChatAnswer> = {
  [CANNED_CHAT_PROMPTS.payroll]: {
    text: 'Under your baseline forecast, your cash on Friday Nov 6 drops to $3,000.00 after paying $12,000.00 payroll. Because your reserve threshold is $5,000.00, this creates a $2,000.00 shortfall breach. However, offering a 5% discount on invoice INV-1001 ($3,500.00) to Bluefin Media accelerates $3,325.00 in cash by Friday, which will fully cover payroll and keep your balance $1,325.00 above the reserve.',
    toolCalls: [
      {
        name: 'forecast',
        args: { horizonDays: 30, asOf: '2026-11-02' },
        result: {
          lowestDate: '2026-11-06',
          lowestAmount: 300000,
          shortfall: 200000,
          breach: true,
        },
      },
      {
        name: 'simulate_scenario',
        args: { changeType: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 5 },
        result: { closesGap: true, lowestDelta: 332500, shortfallDelta: 200000 },
      },
    ],
    comparison: mockScenarioComparison,
    forecast: baselineForecast,
  },

  [CANNED_CHAT_PROMPTS.stock]: {
    text: 'Buying $3,000.00 (300,000 cents) of stock on Monday Nov 9 would deepen your post-payroll cash dip. Even after incoming customer receipts on Monday, your projected balance would hover at $3,000.00, remaining $2,000.00 below your required reserve until mid-November. I recommend deferring this inventory purchase until Bluefin Media or Crestview Logistics settles their overdue balances.',
    toolCalls: [
      {
        name: 'simulate_scenario',
        args: { changeType: 'PURCHASE', label: 'Inventory Stock', amount: 300000, date: '2026-11-09' },
        result: {
          closesGap: false,
          lowestAmount: 300000,
          shortfall: 200000,
          belowReserve: true,
        },
      },
    ],
    forecast: baselineForecast,
  },

  [CANNED_CHAT_PROMPTS.chase]: {
    text: 'You should chase Bluefin Media for invoice INV-1001 ($3,500.00, 9 days overdue) first. They have a moderate lateness risk (0.35) and a 5% settlement discount ($175.00 cost) will bring in $3,325.00 immediately, which is the single action that eliminates your upcoming payroll reserve shortfall.',
    toolCalls: [
      {
        name: 'rank_invoices',
        args: { criteria: 'impact_on_shortfall' },
        result: [
          { invoiceId: 'inv_001', amount: 350000, impactScore: 0.95 },
          { invoiceId: 'inv_002', amount: 300000, impactScore: 0.65 },
        ],
      },
    ],
    comparison: mockScenarioComparison,
  },
};

export const fallbackChatAnswer: ChatAnswer = {
  text: 'I can analyze cashflow scenarios, upcoming payroll obligations, and invoice recovery strategies. Try asking: "Can I cover payroll on Friday?", "What if I buy $3,000 of stock on Monday?", or "Which invoice should I chase first?".',
  toolCalls: [],
};

