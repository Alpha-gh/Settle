import { z } from 'zod';
import type { Cents, ActionRecord, ForecastResult } from '@settle/shared';

/**
 * ImpactSummary is NOT present in @settle/shared.
 * Recorded in CONTRACT_CHANGE_REQUEST.md.
 */
export interface ImpactSummary {
  cashRecovered: Cents;
  projectedShortfallClosed: Cents;
  actionsCount: number;
  actionsExecuted: number;
  gapClosed: boolean;
}

export const impactSummarySchema = z.object({
  cashRecovered: z.number().int(),
  projectedShortfallClosed: z.number().int(),
  actionsCount: z.number().int(),
  actionsExecuted: z.number().int(),
  gapClosed: z.boolean(),
});

/**
 * Derives ImpactSummary client-side from actions and forecast.
 * Per AGENT_RULES.md (Rule 2 & 9):
 * Uses plain summation of engine-provided cents only. No business arithmetic.
 */
export function deriveImpactSummary(
  actions: ActionRecord[],
  forecast: ForecastResult,
  baselineShortfall: Cents = 200000,
): ImpactSummary {
  const executed = actions.filter((a) => a.status === 'EXECUTED');

  // Summation of engine-provided cents
  const cashRecovered = executed.reduce((sum, a) => {
    // If simulation provided cash cost or receipts, or plain summation
    if (a.simulation) {
      return sum + (a.simulation.scenario.lowest.amount - a.simulation.baseline.lowest.amount > 0
        ? a.simulation.scenario.lowest.amount - a.simulation.baseline.lowest.amount
        : 0);
    }
    return sum;
  }, 0);

  const shortfallDifference = Math.max(0, baselineShortfall - forecast.shortfall);
  const gapClosed = forecast.firstBreachDate === null && baselineShortfall > 0;

  return {
    cashRecovered,
    projectedShortfallClosed: shortfallDifference,
    actionsCount: actions.length,
    actionsExecuted: executed.length,
    gapClosed,
  };
}

