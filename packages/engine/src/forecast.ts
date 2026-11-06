import type {
  Cents,
  DayBalance,
  ForecastInput,
  ForecastResult,
  ISODate,
} from '@settle/shared';
import { addDays, assertISODate, compareISO } from './dates.js';
import { EngineError } from './errors.js';
import { assertCents } from './money.js';

export function forecast(input: ForecastInput): ForecastResult {
  if (!input || typeof input !== 'object') {
    throw new EngineError('INVALID_INPUT', 'Forecast input must be a non-null object');
  }

  const { business, obligations, receipts, horizonDays, includeUncertain = false } = input;

  if (!business || typeof business !== 'object') {
    throw new EngineError('INVALID_INPUT', 'business must be provided');
  }

  assertISODate(business.asOf);
  assertCents(business.startingBalance);
  assertCents(business.reserveThreshold);

  if (
    typeof horizonDays !== 'number' ||
    !Number.isInteger(horizonDays) ||
    horizonDays < 1
  ) {
    throw new EngineError(
      'INVALID_INPUT',
      `horizonDays must be an integer >= 1, got ${horizonDays}`,
    );
  }

  if (!Array.isArray(obligations)) {
    throw new EngineError('INVALID_INPUT', 'obligations must be an array');
  }

  if (!Array.isArray(receipts)) {
    throw new EngineError('INVALID_INPUT', 'receipts must be an array');
  }

  for (const obl of obligations) {
    if (!obl || typeof obl !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Obligation must be a non-null object');
    }
    assertISODate(obl.dueDate);
    assertCents(obl.amount);
    if (obl.amount < 0) {
      throw new EngineError(
        'INVALID_INPUT',
        `Obligation amount must be non-negative, got ${obl.amount}`,
      );
    }
  }

  for (const rec of receipts) {
    if (!rec || typeof rec !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Receipt must be a non-null object');
    }
    assertISODate(rec.date);
    assertCents(rec.amount);
    if (rec.amount < 0) {
      throw new EngineError(
        'INVALID_INPUT',
        `Receipt amount must be non-negative, got ${rec.amount}`,
      );
    }
    if (
      rec.confidence !== 'confirmed' &&
      rec.confidence !== 'expected' &&
      rec.confidence !== 'uncertain'
    ) {
      throw new EngineError('INVALID_INPUT', `Invalid receipt confidence: "${rec.confidence}"`);
    }
  }

  const asOf = business.asOf;
  const horizonEnd = addDays(asOf, horizonDays - 1);

  const outflowsByDate = new Map<ISODate, Cents>();
  for (const obl of obligations) {
    if (compareISO(obl.dueDate, horizonEnd) > 0) {
      continue;
    }
    const effectiveDate = compareISO(obl.dueDate, asOf) < 0 ? asOf : obl.dueDate;
    const current = outflowsByDate.get(effectiveDate) ?? 0;
    outflowsByDate.set(effectiveDate, current + obl.amount);
  }

  const receiptsByDate = new Map<ISODate, Cents>();
  for (const rec of receipts) {
    if (rec.confidence === 'uncertain' && !includeUncertain) {
      continue;
    }
    if (compareISO(rec.date, horizonEnd) > 0) {
      continue;
    }
    const effectiveDate = compareISO(rec.date, asOf) < 0 ? asOf : rec.date;
    const current = receiptsByDate.get(effectiveDate) ?? 0;
    receiptsByDate.set(effectiveDate, current + rec.amount);
  }

  const days: DayBalance[] = [];
  let lowestDayIndex = 0;
  let firstBreachDate: ISODate | null = null;

  for (let t = 0; t < horizonDays; t++) {
    const date = addDays(asOf, t);
    const dayReceipts = receiptsByDate.get(date) ?? 0;
    const dayOutflows = outflowsByDate.get(date) ?? 0;

    const previousClosing = t === 0 ? business.startingBalance : (days[t - 1]?.closing ?? 0);
    const closing = previousClosing + dayReceipts - dayOutflows;
    const belowReserve = closing < business.reserveThreshold;

    if (belowReserve && firstBreachDate === null) {
      firstBreachDate = date;
    }

    days.push({
      date,
      receipts: dayReceipts,
      outflows: dayOutflows,
      closing,
      belowReserve,
    });

    const lowestClosing = days[lowestDayIndex]?.closing;
    if (lowestClosing !== undefined && closing < lowestClosing) {
      lowestDayIndex = t;
    }
  }

  const lowestDay = days[lowestDayIndex] ?? days[0]!;

  const lowest = {
    date: lowestDay.date,
    amount: lowestDay.closing,
  };

  const shortfall = Math.max(0, business.reserveThreshold - lowest.amount);

  return {
    days,
    lowest,
    firstBreachDate,
    shortfall,
  };
}
