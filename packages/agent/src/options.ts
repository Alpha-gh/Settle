import type {
  Cents,
  Invoice,
  ISODate,
  Payer,
  ScenarioChange,
  ScenarioComparison,
} from '@settle/shared';

export interface Candidate {
  id: string; // opt_1..opt_n, and "escalate"
  change: ScenarioChange;
  cashCost: Cents;
  lowestDelta: Cents;
  shortfallDelta: Cents;
  closesGap: boolean;
  assumptions: string[];
  baselineFirstBreachDate: ISODate | null;
  // Snapshot facts
  invoiceNumber: string;
  dueDate: ISODate;
  remainingAmount: Cents;
  payerName: string;
  payerPersona: string;
}

export type Situation =
  | 'gap already closed by earlier choices'
  | 'this option closes the gap'
  | 'nothing closes the gap';

export interface EligibleResult {
  eligible: Candidate[];
  situation: Situation;
}

/**
 * Filter simulations down to ELIGIBLE options according to working forecast:
 * (a) if working baseline has no breach (firstBreachDate === null):
 *     options with lowest cashCost (normally REMIND, ties kept)
 * (b) else if some option closes the gap:
 *     options that close the gap with lowest cashCost
 * (c) else:
 *     options with largest lowestDelta, ties broken by lowest cashCost
 *
 * Eligible options are assigned stable IDs: opt_1, opt_2, ...
 */
export function filterEligibleCandidates(
  simulations: ScenarioComparison[],
  invoice: Invoice,
  payer: Payer,
): EligibleResult {
  if (simulations.length === 0) {
    return {
      eligible: [],
      situation: 'nothing closes the gap',
    };
  }

  const remainingAmount = invoice.amount - invoice.amountPaid;
  const anyClosesGap = simulations.some((s) => s.closesGap);
  const hasBreach = simulations[0]?.baseline.firstBreachDate !== null || anyClosesGap;

  let selectedSims: ScenarioComparison[];
  let situation: Situation;

  if (!hasBreach) {
    situation = 'gap already closed by earlier choices';
    const minCost = Math.min(...simulations.map((s) => s.cashCost));
    selectedSims = simulations.filter((s) => s.cashCost === minCost);
  } else {
    const closing = simulations.filter((s) => s.closesGap);
    if (closing.length > 0) {
      situation = 'this option closes the gap';
      const minCost = Math.min(...closing.map((s) => s.cashCost));
      selectedSims = closing.filter((s) => s.cashCost === minCost);
    } else {
      situation = 'nothing closes the gap';
      const maxDelta = Math.max(...simulations.map((s) => s.lowestDelta));
      const topDelta = simulations.filter((s) => s.lowestDelta === maxDelta);
      const minCost = Math.min(...topDelta.map((s) => s.cashCost));
      selectedSims = topDelta.filter((s) => s.cashCost === minCost);
    }
  }

  const eligible: Candidate[] = selectedSims.map((sim, index) => ({
    id: `opt_${index + 1}`,
    change: sim.change,
    cashCost: sim.cashCost,
    lowestDelta: sim.lowestDelta,
    shortfallDelta: sim.shortfallDelta,
    closesGap: sim.closesGap,
    assumptions: sim.assumptions,
    baselineFirstBreachDate: sim.baseline.firstBreachDate,
    invoiceNumber: invoice.number,
    dueDate: invoice.dueDate,
    remainingAmount,
    payerName: payer.name,
    payerPersona: payer.persona,
  }));

  return { eligible, situation };
}

/**
 * Build candidate list from engine simulations and invoice/payer snapshot data.
 * Ids are stable opt_1..opt_n in generateOptions order, followed by a final "escalate".
 * The agent never computes new numbers.
 */
export function buildCandidates(
  simulations: ScenarioComparison[],
  invoice: Invoice,
  payer: Payer,
): Candidate[] {
  const remainingAmount = invoice.amount - invoice.amountPaid;
  const baselineFirstBreach = simulations[0]?.baseline.firstBreachDate ?? null;

  const candidates: Candidate[] = simulations.map((sim, index) => ({
    id: `opt_${index + 1}`,
    change: sim.change,
    cashCost: sim.cashCost,
    lowestDelta: sim.lowestDelta,
    shortfallDelta: sim.shortfallDelta,
    closesGap: sim.closesGap,
    assumptions: sim.assumptions,
    baselineFirstBreachDate: sim.baseline.firstBreachDate,
    invoiceNumber: invoice.number,
    dueDate: invoice.dueDate,
    remainingAmount,
    payerName: payer.name,
    payerPersona: payer.persona,
  }));

  // Final escalate candidate
  candidates.push({
    id: 'escalate',
    change: {
      type: 'ESCALATE' as unknown as ScenarioChange['type'],
      invoiceId: invoice.id,
    } as unknown as ScenarioChange,
    cashCost: 0,
    lowestDelta: 0,
    shortfallDelta: 0,
    closesGap: false,
    assumptions: ['Manual collection / external escalation required'],
    baselineFirstBreachDate: baselineFirstBreach,
    invoiceNumber: invoice.number,
    dueDate: invoice.dueDate,
    remainingAmount,
    payerName: payer.name,
    payerPersona: payer.persona,
  });

  return candidates;
}

