import type {
  EnginePort,
  ExpectedReceipt,
  ForecastInput,
  ISODate,
  ScenarioChange,
} from '@settle/shared';

export interface EngineWithApply extends EnginePort {
  applyChange(input: ForecastInput, change: ScenarioChange): ForecastInput;
}

function isoToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function jdnToIso(jdn: number): ISODate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDaysToIso(isoDate: ISODate, days: number): ISODate {
  const parts = isoDate.split('-');
  const y = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  const d = parseInt(parts[2]!, 10);
  const jdn = isoToJdn(y, m, d) + days;
  return jdnToIso(jdn);
}

/**
 * Applies a scenario change to the working forecast input.
 * Delegates to engine.applyChange if present on the engine instance.
 * Otherwise uses a deterministic integer-cents fallback.
 */
export function applyChosenChange(
  engine: EnginePort,
  input: ForecastInput,
  change: ScenarioChange,
): ForecastInput {
  // Use EngineWithApply if implemented
  if (
    'applyChange' in engine &&
    typeof (engine as EngineWithApply).applyChange === 'function'
  ) {
    return (engine as EngineWithApply).applyChange(input, change);
  }

  // DEVIATION: arithmetic outside engine, see CONTRACT_CHANGE_REQUEST.md
  if (!('invoiceId' in change)) {
    return input;
  }

  const invoiceId = change.invoiceId;
  const existingIndex = input.receipts.findIndex((r) => r.invoiceId === invoiceId);

  if (existingIndex === -1) {
    return input;
  }

  const existingReceipt = input.receipts[existingIndex]!;
  const newReceipts = [...input.receipts];

  switch (change.type) {
    case 'REMIND': {
      newReceipts[existingIndex] = {
        ...existingReceipt,
        date: change.newExpectedDate,
      };
      break;
    }

    case 'OFFER_DISCOUNT': {
      // Reduce receipt amount using integer arithmetic (no floating point)
      const discountAmount = Math.floor(
        (existingReceipt.amount * change.discountPct) / 100,
      );
      const newAmount = existingReceipt.amount - discountAmount;
      newReceipts[existingIndex] = {
        ...existingReceipt,
        amount: newAmount,
        date: change.newExpectedDate,
      };
      break;
    }

    case 'OFFER_INSTALMENTS': {
      // Split into count receipts with remainder on the first
      const count = Math.max(1, change.count);
      const baseAmount = Math.floor(existingReceipt.amount / count);
      const remainder = existingReceipt.amount % count;

      const instalments: ExpectedReceipt[] = [];
      for (let i = 0; i < count; i++) {
        const amount = i === 0 ? baseAmount + remainder : baseAmount;
        const date = addDaysToIso(change.firstDate, i * change.spacingDays);
        instalments.push({
          invoiceId: existingReceipt.invoiceId,
          amount,
          date,
          confidence: existingReceipt.confidence,
        });
      }

      newReceipts.splice(existingIndex, 1, ...instalments);
      break;
    }

    default:
      break;
  }

  return {
    ...input,
    receipts: newReceipts,
  };
}

