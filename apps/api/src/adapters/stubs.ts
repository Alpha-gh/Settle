import type {
  ActionRecord,
  AgentPort,
  AgentRunResult,
  ChatAnswer,
  Confidence,
  DayBalance,
  EnginePort,
  ExpectedReceipt,
  ForecastInput,
  ForecastResult,
  Invoice,
  ISODate,
  Kpis,
  Obligation,
  Payer,
  Policy,
  ScenarioChange,
  ScenarioComparison,
  Snapshot,
} from '@settle/shared';
import { evaluatePolicy } from '@settle/shared';

function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class StubEngine implements EnginePort {
  expectedReceipts(invoices: Invoice[], payers: Payer[], asOf: ISODate): ExpectedReceipt[] {
    const payerMap = new Map(payers.map((p) => [p.id, p]));
    const receipts: ExpectedReceipt[] = [];

    for (const inv of invoices) {
      if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'REFUNDED') {
        continue;
      }
      const remaining = inv.amount - inv.amountPaid;
      if (remaining <= 0) continue;

      const payer = payerMap.get(inv.payerId);
      const persona = payer?.persona || 'slow';
      const avgLate = payer?.avgDaysLate || 7;

      let date = inv.dueDate;
      let confidence: Confidence = 'expected';

      if (persona === 'reliable') {
        confidence = 'confirmed';
        date = inv.dueDate < asOf ? asOf : inv.dueDate;
      } else if (persona === 'slow') {
        confidence = 'expected';
        date = addDays(inv.dueDate < asOf ? asOf : inv.dueDate, avgLate);
      } else {
        confidence = 'uncertain';
        date = addDays(asOf, avgLate + 14);
      }

      receipts.push({
        invoiceId: inv.id,
        amount: remaining,
        date,
        confidence,
      });
    }

    return receipts;
  }

  forecast(input: ForecastInput): ForecastResult {
    const horizon = input.horizonDays || 30;
    const includeUncertain = input.includeUncertain ?? false;
    const reserve = input.business.reserveThreshold;

    const receiptMap = new Map<ISODate, number>();
    for (const r of input.receipts) {
      if (!includeUncertain && r.confidence === 'uncertain') {
        continue;
      }
      receiptMap.set(r.date, (receiptMap.get(r.date) || 0) + r.amount);
    }

    const obligationMap = new Map<ISODate, number>();
    for (const o of input.obligations) {
      obligationMap.set(o.dueDate, (obligationMap.get(o.dueDate) || 0) + o.amount);
    }

    const days: DayBalance[] = [];
    let currentBalance = input.business.startingBalance;
    let lowestAmount = currentBalance;
    let lowestDate = input.business.asOf;
    let firstBreachDate: ISODate | null = null;

    for (let i = 0; i < horizon; i++) {
      const date = addDays(input.business.asOf, i);
      const inflows = receiptMap.get(date) || 0;
      const outflows = obligationMap.get(date) || 0;
      currentBalance = currentBalance + inflows - outflows;

      const belowReserve = currentBalance < reserve;
      if (belowReserve && firstBreachDate === null) {
        firstBreachDate = date;
      }

      if (currentBalance < lowestAmount) {
        lowestAmount = currentBalance;
        lowestDate = date;
      }

      days.push({
        date,
        receipts: inflows,
        outflows,
        closing: currentBalance,
        belowReserve,
      });
    }

    const shortfall = Math.max(0, reserve - lowestAmount);

    return {
      days,
      lowest: {
        date: lowestDate,
        amount: lowestAmount,
      },
      firstBreachDate,
      shortfall,
    };
  }

  simulate(input: ForecastInput, change: ScenarioChange): ScenarioComparison {
    const baseline = this.forecast(input);

    const modifiedReceipts: ExpectedReceipt[] = input.receipts.map((r) => ({ ...r }));
    const modifiedObligations: Obligation[] = input.obligations.map((o) => ({ ...o }));
    let cashCost = 0;
    const assumptions: string[] = [];

    switch (change.type) {
      case 'REMIND': {
        const idx = modifiedReceipts.findIndex((r) => r.invoiceId === change.invoiceId);
        if (idx !== -1) {
          modifiedReceipts[idx] = {
            ...modifiedReceipts[idx],
            date: change.newExpectedDate,
            confidence: 'confirmed',
          };
        }
        assumptions.push(`Reminder accelerates payment of invoice to ${change.newExpectedDate}.`);
        break;
      }

      case 'OFFER_DISCOUNT': {
        const idx = modifiedReceipts.findIndex((r) => r.invoiceId === change.invoiceId);
        if (idx !== -1) {
          const orig = modifiedReceipts[idx].amount;
          const discountAmt = Math.round((orig * change.discountPct) / 100);
          cashCost = discountAmt;
          modifiedReceipts[idx] = {
            ...modifiedReceipts[idx],
            amount: orig - discountAmt,
            date: change.newExpectedDate,
            confidence: 'confirmed',
          };
        }
        assumptions.push(
          `A ${change.discountPct}% discount incentivizes early payment by ${change.newExpectedDate}.`,
        );
        break;
      }

      case 'OFFER_INSTALMENTS': {
        const idx = modifiedReceipts.findIndex((r) => r.invoiceId === change.invoiceId);
        if (idx !== -1) {
          const total = modifiedReceipts[idx].amount;
          modifiedReceipts.splice(idx, 1);
          const perInstalment = Math.floor(total / change.count);
          for (let i = 0; i < change.count; i++) {
            const date = addDays(change.firstDate, i * change.spacingDays);
            modifiedReceipts.push({
              invoiceId: `${change.invoiceId}_inst_${i + 1}`,
              amount: i === change.count - 1 ? total - perInstalment * (change.count - 1) : perInstalment,
              date,
              confidence: 'expected',
            });
          }
        }
        assumptions.push(
          `Instalments split the total into ${change.count} parts every ${change.spacingDays} days starting ${change.firstDate}.`,
        );
        break;
      }

      case 'PURCHASE': {
        modifiedObligations.push({
          id: `obl_pur_${Date.now()}`,
          label: change.label,
          kind: 'other',
          amount: change.amount,
          dueDate: change.date,
        });
        assumptions.push(`New planned purchase of $${(change.amount / 100).toFixed(2)} on ${change.date}.`);
        break;
      }
    }

    const scenario = this.forecast({
      ...input,
      receipts: modifiedReceipts,
      obligations: modifiedObligations,
    });

    const lowestDelta = scenario.lowest.amount - baseline.lowest.amount;
    const shortfallDelta = baseline.shortfall - scenario.shortfall;
    const closesGap = baseline.firstBreachDate !== null && scenario.firstBreachDate === null;

    return {
      change,
      baseline,
      scenario,
      lowestDelta,
      shortfallDelta,
      cashCost,
      closesGap,
      assumptions,
    };
  }

  generateOptions(
    input: ForecastInput,
    invoice: Invoice,
    payer: Payer,
    policy: Policy,
  ): ScenarioChange[] {
    const options: ScenarioChange[] = [];
    const remaining = invoice.amount - invoice.amountPaid;
    if (remaining <= 0) return options;

    // 1. Remind option
    options.push({
      type: 'REMIND',
      invoiceId: invoice.id,
      newExpectedDate: addDays(input.business.asOf, 3),
    });

    // 2. Discount option
    const discountPct = Math.min(policy.maxDiscountPct, 5);
    if (discountPct > 0) {
      options.push({
        type: 'OFFER_DISCOUNT',
        invoiceId: invoice.id,
        discountPct,
        newExpectedDate: addDays(input.business.asOf, 2),
      });
    }

    // 3. Instalments option
    if (policy.maxInstalments >= 2) {
      options.push({
        type: 'OFFER_INSTALMENTS',
        invoiceId: invoice.id,
        count: Math.min(policy.maxInstalments, 3),
        spacingDays: 7,
        firstDate: addDays(input.business.asOf, 3),
      });
    }

    return options;
  }

  kpis(snapshot: Snapshot): Kpis {
    const receipts = this.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const forecastResult = this.forecast({
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    });

    let overdueTotal = 0;
    let overdueCount = 0;
    let totalDaysLate = 0;

    for (const inv of snapshot.invoices) {
      if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'REFUNDED') {
        continue;
      }
      if (inv.dueDate < snapshot.business.asOf) {
        const rem = inv.amount - inv.amountPaid;
        overdueTotal += rem;
        overdueCount++;
        const payer = snapshot.payers.find((p) => p.id === inv.payerId);
        totalDaysLate += payer?.avgDaysLate || 5;
      }
    }

    const sortedObligations = [...snapshot.obligations]
      .filter((o) => o.dueDate >= snapshot.business.asOf)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
      cash: snapshot.business.startingBalance,
      overdueTotal,
      overdueCount,
      avgDaysLate: overdueCount > 0 ? Math.round(totalDaysLate / overdueCount) : 0,
      lowest: forecastResult.lowest,
      shortfall: forecastResult.shortfall,
      nextObligation: sortedObligations[0],
    };
  }
}

export class StubAgent implements AgentPort {
  private readonly engine = new StubEngine();

  async runCycle(snapshot: Snapshot): Promise<AgentRunResult> {
    const actions: ActionRecord[] = [];
    const skipped: { invoiceId: string; why: string }[] = [];
    const now = new Date(snapshot.business.asOf + 'T12:00:00Z');

    const overdue = snapshot.invoices.filter(
      (inv) =>
        inv.dueDate < snapshot.business.asOf &&
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'REFUNDED',
    );

    const payerMap = new Map(snapshot.payers.map((p) => [p.id, p]));

    for (const inv of overdue) {
      const payer = payerMap.get(inv.payerId);
      const isGhost = payer?.persona === 'ghost';

      if (isGhost) {
        // Ghost payer: propose ESCALATE
        const verdict = evaluatePolicy(
          { type: 'ESCALATE', params: {} },
          inv,
          snapshot.policy,
          { now, remindersLastWeek: 0 },
        );

        actions.push({
          id: `act_${Date.now()}_${inv.id}`,
          invoiceId: inv.id,
          type: 'ESCALATE',
          params: {},
          reason: `Payer ${payer.name} is classified as a ghost; escalating for human intervention.`,
          policy: verdict,
          status: 'AWAITING_APPROVAL',
          createdAt: new Date().toISOString(),
          decidedBy: undefined,
        });
      } else {
        // Propose REMIND
        const verdict = evaluatePolicy(
          { type: 'REMIND', params: { note: 'Friendly reminder to pay invoice.' } },
          inv,
          snapshot.policy,
          { now, remindersLastWeek: 0 },
        );

        const receipts = this.engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
        const sim = this.engine.simulate(
          {
            business: snapshot.business,
            obligations: snapshot.obligations,
            receipts,
            horizonDays: 30,
          },
          {
            type: 'REMIND',
            invoiceId: inv.id,
            newExpectedDate: addDays(snapshot.business.asOf, 3),
          },
        );

        actions.push({
          id: `act_${Date.now()}_${inv.id}`,
          invoiceId: inv.id,
          type: 'REMIND',
          params: { note: 'Automated overdue reminder' },
          reason: `Invoice is overdue by ${(inv.amount - inv.amountPaid) / 100} USD; reminder suggested.`,
          simulation: sim,
          policy: verdict,
          status: verdict.requiresApproval ? 'AWAITING_APPROVAL' : 'PROPOSED',
          createdAt: new Date().toISOString(),
          decidedBy: verdict.requiresApproval ? undefined : 'auto',
        });
      }
    }

    return {
      runId: `run_${Date.now()}`,
      actions,
      skipped,
    };
  }

  async chat(question: string, snapshot: Snapshot): Promise<ChatAnswer> {
    const kpis = this.engine.kpis(snapshot);
    const text = `Current starting cash is $${(kpis.cash / 100).toFixed(2)} with $${(kpis.overdueTotal / 100).toFixed(2)} in ${kpis.overdueCount} overdue invoices. The projected lowest balance is $${(kpis.lowest.amount / 100).toFixed(2)} on ${kpis.lowest.date}, with a shortfall of $${(kpis.shortfall / 100).toFixed(2)} against the reserve of $${(snapshot.business.reserveThreshold / 100).toFixed(2)}. Next obligation is ${kpis.nextObligation?.label || 'none'} on ${kpis.nextObligation?.dueDate || 'N/A'}.`;

    const receipts = this.engine.expectedReceipts(snapshot.invoices, snapshot.payers, snapshot.business.asOf);
    const forecast = this.engine.forecast({
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    });

    return {
      text,
      toolCalls: [
        {
          name: 'getForecast',
          args: { asOf: snapshot.business.asOf },
          result: forecast,
        },
      ],
      forecast,
    };
  }
}

