/**
 * TEST ONLY: arithmetic here is not production logic.
 *
 * This fake engine implements EnginePort for testing System 3 (Agent) in isolation.
 */

import type {
  EnginePort,
  ExpectedReceipt,
  ForecastInput,
  ForecastResult,
  Invoice,
  ISODate,
  Kpis,
  Payer,
  Policy,
  ScenarioChange,
  ScenarioComparison,
  Snapshot,
} from '@settle/shared';

export interface FakeEngineOptions {
  closesGapMap?: Map<string, boolean> | Record<string, boolean>;
  defaultClosesGap?: boolean;
}

export class FakeEngine implements EnginePort {
  private readonly closesGapMap: Map<string, boolean>;
  private readonly defaultClosesGap: boolean;

  constructor(options: FakeEngineOptions = {}) {
    this.defaultClosesGap = options.defaultClosesGap ?? false;
    if (options.closesGapMap instanceof Map) {
      this.closesGapMap = new Map(options.closesGapMap);
    } else if (options.closesGapMap) {
      this.closesGapMap = new Map(Object.entries(options.closesGapMap));
    } else {
      this.closesGapMap = new Map();
    }
  }

  generateOptions(
    _input: ForecastInput,
    invoice: Invoice,
    payer: Payer,
    _policy: Policy,
  ): ScenarioChange[] {
    const defaultDate: ISODate = invoice.dueDate;

    switch (payer.persona) {
      case 'reliable':
        return [
          {
            type: 'REMIND',
            invoiceId: invoice.id,
            newExpectedDate: defaultDate,
          },
        ];

      case 'slow':
        return [
          {
            type: 'REMIND',
            invoiceId: invoice.id,
            newExpectedDate: defaultDate,
          },
          {
            type: 'OFFER_DISCOUNT',
            invoiceId: invoice.id,
            discountPct: 3,
            newExpectedDate: defaultDate,
          },
        ];

      case 'chronic':
        return [
          {
            type: 'REMIND',
            invoiceId: invoice.id,
            newExpectedDate: defaultDate,
          },
          {
            type: 'OFFER_INSTALMENTS',
            invoiceId: invoice.id,
            count: 3,
            spacingDays: 30,
            firstDate: defaultDate,
          },
        ];

      case 'ghost':
        return [];

      default:
        return [
          {
            type: 'REMIND',
            invoiceId: invoice.id,
            newExpectedDate: defaultDate,
          },
        ];
    }
  }

  simulate(
    input: ForecastInput,
    change: ScenarioChange,
  ): ScenarioComparison {
    const invoiceId = 'invoiceId' in change ? change.invoiceId : change.label;
    const typeAndIdKey = `${change.type}:${invoiceId}`;

    const closesGap =
      this.closesGapMap.get(typeAndIdKey) ??
      this.closesGapMap.get(invoiceId) ??
      this.closesGapMap.get(change.type) ??
      this.defaultClosesGap;

    const baseline = this.forecast(input);

    const scenarioAmount = input.business.startingBalance + (closesGap ? 250000 : 50000);
    const scenario: ForecastResult = {
      days: [
        {
          date: input.business.asOf,
          receipts: closesGap ? 250000 : 50000,
          outflows: 0,
          closing: scenarioAmount,
          belowReserve: scenarioAmount < input.business.reserveThreshold,
        },
      ],
      lowest: {
        date: input.business.asOf,
        amount: scenarioAmount,
      },
      firstBreachDate: closesGap ? null : baseline.firstBreachDate,
      shortfall: closesGap ? 0 : Math.max(0, baseline.shortfall - 50000),
    };

    let cashCost = 0;
    if (change.type === 'OFFER_DISCOUNT') {
      cashCost = Math.floor((300000 * change.discountPct) / 100);
    }

    return {
      change,
      baseline,
      scenario,
      lowestDelta: closesGap ? 250000 : 50000,
      shortfallDelta: closesGap ? baseline.shortfall : 50000,
      cashCost,
      closesGap,
      assumptions: [
        'Payer acknowledges communication within standard turnaround',
        'Settlement arrives before upcoming payroll obligation',
      ],
    };
  }

  forecast(input: ForecastInput): ForecastResult {
    const isBreach = input.business.startingBalance < input.business.reserveThreshold;
    const shortfall = Math.max(
      0,
      input.business.reserveThreshold - input.business.startingBalance,
    );

    return {
      days: [
        {
          date: input.business.asOf,
          receipts: 0,
          outflows: 0,
          closing: input.business.startingBalance,
          belowReserve: isBreach,
        },
      ],
      lowest: {
        date: input.business.asOf,
        amount: input.business.startingBalance,
      },
      firstBreachDate: isBreach ? input.business.asOf : null,
      shortfall,
    };
  }

  expectedReceipts(
    invoices: Invoice[],
    _payers: Payer[],
    _asOf: ISODate,
  ): ExpectedReceipt[] {
    return invoices
      .filter((inv) => inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID')
      .map((inv) => ({
        invoiceId: inv.id,
        amount: inv.amount - inv.amountPaid,
        date: inv.dueDate,
        confidence: 'expected',
      }));
  }

  kpis(snapshot: Snapshot): Kpis {
    const overdueInvoices = snapshot.invoices.filter(
      (inv) =>
        inv.dueDate < snapshot.business.asOf &&
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'REFUNDED',
    );

    const overdueTotal = overdueInvoices.reduce(
      (sum, inv) => sum + (inv.amount - inv.amountPaid),
      0,
    );

    const isBreach =
      snapshot.business.startingBalance < snapshot.business.reserveThreshold;

    return {
      cash: snapshot.business.startingBalance,
      overdueTotal,
      overdueCount: overdueInvoices.length,
      avgDaysLate: 14,
      lowest: {
        date: snapshot.business.asOf,
        amount: snapshot.business.startingBalance,
      },
      shortfall: isBreach
        ? snapshot.business.reserveThreshold - snapshot.business.startingBalance
        : 0,
      nextObligation: snapshot.obligations[0],
    };
  }
}

