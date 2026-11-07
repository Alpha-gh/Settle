import type { Kpis, Obligation, Snapshot } from '@settle/shared';
import { compareISO, diffDays } from './dates.js';
import { EngineError } from './errors.js';
import { expectedReceipts } from './expectedReceipts.js';
import { forecast } from './forecast.js';
import { applyDiscount, assertCents, roundHalfUpDiv } from './money.js';

export function kpis(snapshot: Snapshot): Kpis {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new EngineError('INVALID_INPUT', 'Snapshot must be a non-null object');
  }

  const { business, invoices, payers, obligations } = snapshot;
  if (!business || typeof business !== 'object') {
    throw new EngineError('INVALID_INPUT', 'business must be provided');
  }

  if (!Array.isArray(invoices)) {
    throw new EngineError('INVALID_INPUT', 'invoices must be an array');
  }

  if (!Array.isArray(payers)) {
    throw new EngineError('INVALID_INPUT', 'payers must be an array');
  }

  if (!Array.isArray(obligations)) {
    throw new EngineError('INVALID_INPUT', 'obligations must be an array');
  }

  const asOf = business.asOf;
  assertCents(business.startingBalance);
  assertCents(business.reserveThreshold);

  // cash = business.startingBalance (value as of asOf)
  const cash = business.startingBalance;

  // Open invoice = status SENT or PARTIALLY_PAID. Overdue = open and dueDate < asOf.
  let overdueTotal = 0;
  let overdueCount = 0;
  let totalDaysLate = 0;

  for (const inv of invoices) {
    if (!inv || typeof inv !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Invoice must be a non-null object');
    }
    const isOpen = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';
    if (isOpen && compareISO(inv.dueDate, asOf) < 0) {
      assertCents(inv.amount);
      assertCents(inv.amountPaid);
      const remaining = Math.max(
        0,
        applyDiscount(inv.amount, inv.discountPct ?? 0) - inv.amountPaid,
      );
      overdueTotal += remaining;
      overdueCount++;
      const daysLate = diffDays(asOf, inv.dueDate);
      totalDaysLate += daysLate;
    }
  }

  // avgDaysLate = round-half-up mean of (asOf - dueDate in days) over overdue invoices; 0 when none (no NaN)
  const avgDaysLate = overdueCount > 0 ? roundHalfUpDiv(totalDaysLate, overdueCount) : 0;

  // lowest and shortfall = from forecast with horizonDays 30, includeUncertain false,
  // receipts = expectedReceipts(snapshot.invoices, snapshot.payers, asOf)
  const receipts = expectedReceipts(invoices, payers, asOf);
  const forecastResult = forecast({
    business,
    obligations,
    receipts,
    horizonDays: 30,
    includeUncertain: false,
  });

  const lowest = forecastResult.lowest;
  const shortfall = forecastResult.shortfall;

  // nextObligation = obligation with the earliest dueDate >= asOf (ties: lowest id); omit the field if none
  const futureObligations: Obligation[] = [];
  for (const obl of obligations) {
    if (!obl || typeof obl !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Obligation must be a non-null object');
    }
    if (compareISO(obl.dueDate, asOf) >= 0) {
      futureObligations.push(obl);
    }
  }

  futureObligations.sort((a, b) => {
    const cmp = compareISO(a.dueDate, b.dueDate);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });

  const nextObligation = futureObligations[0];

  const result: Kpis = {
    cash,
    overdueTotal,
    overdueCount,
    avgDaysLate,
    lowest,
    shortfall,
  };

  if (nextObligation) {
    result.nextObligation = nextObligation;
  }

  return result;
}
