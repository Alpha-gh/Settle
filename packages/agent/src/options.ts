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

