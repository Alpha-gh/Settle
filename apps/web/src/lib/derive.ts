import type { ISODate } from '@settle/shared';

/**
 * Derived calculation functions.
 * Per AGENT_RULES.md (Rule 2):
 * "All numbers shown come from the API. No business arithmetic.
 *  The only allowed derivations live in src/lib/derive.ts
 *  (currently: daysOverdue = whole days between invoice.dueDate and business.asOf, clamped at 0).
 *  Each is unit tested and listed in HANDOFF.md."
 */

/**
 * Calculates whole days between invoice.dueDate and business.asOf, clamped at 0.
 * Computed strictly in UTC to avoid daylight savings or local timezone offsets.
 *
 * @param dueDate Due date of the invoice in 'YYYY-MM-DD' format
 * @param asOf Current business asOf date in 'YYYY-MM-DD' format
 * @returns Non-negative integer whole days overdue
 */
export function daysOverdue(dueDate: ISODate, asOf: ISODate): number {
  const [dueY, dueM, dueD] = dueDate.split('-').map(Number);
  const [asOfY, asOfM, asOfD] = asOf.split('-').map(Number);

  if (
    Number.isNaN(dueY) || Number.isNaN(dueM) || Number.isNaN(dueD) ||
    Number.isNaN(asOfY) || Number.isNaN(asOfM) || Number.isNaN(asOfD)
  ) {
    throw new Error(`Invalid date string provided to daysOverdue: dueDate=${dueDate}, asOf=${asOf}`);
  }

  const dueUtc = Date.UTC(dueY!, dueM! - 1, dueD!);
  const asOfUtc = Date.UTC(asOfY!, asOfM! - 1, asOfD!);

  const diffMs = asOfUtc - dueUtc;
  const diffDays = Math.floor(diffMs / 86400000);

  return Math.max(0, diffDays);
}

