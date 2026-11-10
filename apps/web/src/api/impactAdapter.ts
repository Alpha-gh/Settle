import { z } from 'zod';
import type { Cents, ActionRecord, ForecastResult } from '@settle/shared';

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
 * Uses plain summation of engine-provided cents only. No business arithmetic.
 */
export function deriveImpactSummary(
  actions: ActionRecord[],
  forecast: ForecastResult,
  baselineShortfall?: Cents | null,
): ImpactSummary {
  const executed = actions.filter((a) => a.status === 'EXECUTED');

  const cashRecovered = executed.reduce((sum, a) => {
    if (a.simulation) {
      const diff = a.simulation.scenario.lowest.amount - a.simulation.baseline.lowest.amount;
      return sum + (diff > 0 ? diff : 0);
    }
    return sum;
  }, 0);

  const baseShortfall = baselineShortfall ?? 0;
  const shortfallDifference = Math.max(0, baseShortfall - forecast.shortfall);
  const gapClosed = forecast.lowest.amount >= 0 || (forecast.firstBreachDate === null && baseShortfall > 0);

  return {
    cashRecovered,
    projectedShortfallClosed: shortfallDifference,
    actionsCount: actions.length,
    actionsExecuted: executed.length,
    gapClosed,
  };
}

