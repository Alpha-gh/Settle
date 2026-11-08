import type {
  Cents,
  ExpectedReceipt,
  ForecastInput,
  Obligation,
  ScenarioChange,
  ScenarioComparison,
} from '@settle/shared';
import { addDays, assertISODate } from './dates.js';
import { EngineError } from './errors.js';
import { forecast } from './forecast.js';
import { applyDiscount, assertCents } from './money.js';

export function formatMoney(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainingCents = abs % 100;
  const dollarsStr = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const centsStr = remainingCents < 10 ? `0${remainingCents}` : `${remainingCents}`;
  return `${sign}$${dollarsStr}.${centsStr}`;
}

export function simulate(input: ForecastInput, change: ScenarioChange): ScenarioComparison {
  if (!input || typeof input !== 'object') {
    throw new EngineError('INVALID_INPUT', 'Forecast input must be a non-null object');
  }

  if (!change || typeof change !== 'object') {
    throw new EngineError('INVALID_INPUT', 'Scenario change must be a non-null object');
  }

  // Work on a copy; baseline = forecast(input)
  const baseline = forecast(input);

  const assumptions: string[] = [];
  let modifiedReceipts: ExpectedReceipt[] = [...input.receipts];
  let modifiedObligations: Obligation[] = [...input.obligations];
  let cashCost: Cents = 0;

  switch (change.type) {
    case 'REMIND':
    case 'OFFER_DISCOUNT':
    case 'OFFER_INSTALMENTS': {
      const invoiceId = change.invoiceId;
      if (!invoiceId || typeof invoiceId !== 'string') {
        throw new EngineError('INVALID_INPUT', 'invoiceId must be a non-empty string');
      }

      const matchingReceipts: ExpectedReceipt[] = [];
      const remainingReceipts: ExpectedReceipt[] = [];

      for (const r of input.receipts) {
        if (r.invoiceId === invoiceId) {
          matchingReceipts.push(r);
        } else {
          remainingReceipts.push(r);
        }
      }

      if (matchingReceipts.length === 0) {
        throw new EngineError(
          'NOT_FOUND',
          `Invoice ${invoiceId} has no corresponding receipt in forecast input`,
        );
      }

      const originalAmount = matchingReceipts.reduce((sum, r) => sum + r.amount, 0);
      const firstReceipt = matchingReceipts[0]!;
      const prevConfidence = firstReceipt.confidence;
      const prevDate = firstReceipt.date;

      if (matchingReceipts.length > 1) {
        assumptions.push(
          `Invoice ${invoiceId} had ${matchingReceipts.length} separate receipts totaling ${formatMoney(originalAmount)}; treated as one combined receipt.`,
        );
      }

      assumptions.push(
        `Receipt for invoice ${invoiceId} was previously treated as ${prevConfidence} on ${prevDate}.`,
      );

      if (change.type === 'REMIND') {
        assertISODate(change.newExpectedDate);
        cashCost = 0;
        assumptions.push(`Assumes the payer pays on ${change.newExpectedDate} after the reminder.`);

        modifiedReceipts = [
          ...remainingReceipts,
          {
            invoiceId,
            amount: originalAmount,
            date: change.newExpectedDate,
            confidence: 'expected',
          },
        ];
      } else if (change.type === 'OFFER_DISCOUNT') {
        assertISODate(change.newExpectedDate);
        if (
          typeof change.discountPct !== 'number' ||
          !Number.isFinite(change.discountPct) ||
          change.discountPct <= 0 ||
          change.discountPct > 100
        ) {
          throw new EngineError(
            'INVALID_INPUT',
            `Discount percentage must be in (0, 100], got ${change.discountPct}`,
          );
        }

        const discountedAmount = applyDiscount(originalAmount, change.discountPct);
        cashCost = originalAmount - discountedAmount;
        assumptions.push(
          `Assumes the payer accepts a ${change.discountPct}% discount and pays ${formatMoney(discountedAmount)} on ${change.newExpectedDate}.`,
        );

        modifiedReceipts = [
          ...remainingReceipts,
          {
            invoiceId,
            amount: discountedAmount,
            date: change.newExpectedDate,
            confidence: 'expected',
          },
        ];
      } else {
        // OFFER_INSTALMENTS
        assertISODate(change.firstDate);
        if (
          typeof change.count !== 'number' ||
          !Number.isInteger(change.count) ||
          change.count < 2
        ) {
          throw new EngineError(
            'INVALID_INPUT',
            `Instalment count must be an integer >= 2, got ${change.count}`,
          );
        }
        if (
          typeof change.spacingDays !== 'number' ||
          !Number.isInteger(change.spacingDays) ||
          change.spacingDays < 1
        ) {
          throw new EngineError(
            'INVALID_INPUT',
            `spacingDays must be an integer >= 1, got ${change.spacingDays}`,
          );
        }

        cashCost = 0;
        const basePart = Math.floor(originalAmount / change.count);
        const remainder = originalAmount % change.count;

        const instalmentReceipts: ExpectedReceipt[] = [];
        for (let k = 0; k < change.count; k++) {
          const partAmount = k === 0 ? basePart + remainder : basePart;
          const partDate = addDays(change.firstDate, k * change.spacingDays);
          instalmentReceipts.push({
            invoiceId,
            amount: partAmount,
            date: partDate,
            confidence: 'expected',
          });
        }

        assumptions.push(
          `Assumes the payer pays in ${change.count} instalments starting on ${change.firstDate} spaced every ${change.spacingDays} days.`,
        );

        modifiedReceipts = [...remainingReceipts, ...instalmentReceipts];
      }
      break;
    }

    case 'PURCHASE': {
      assertISODate(change.date);
      assertCents(change.amount);
      if (change.amount <= 0) {
        throw new EngineError(
          'INVALID_INPUT',
          `Purchase amount must be a positive integer, got ${change.amount}`,
        );
      }
      if (!change.label || typeof change.label !== 'string') {
        throw new EngineError('INVALID_INPUT', 'Purchase label must be a non-empty string');
      }

      cashCost = 0;
      const purchaseObligation: Obligation = {
        id: 'sim-purchase-1',
        label: change.label,
        kind: 'other',
        amount: change.amount,
        dueDate: change.date,
      };

      modifiedObligations = [...input.obligations, purchaseObligation];
      assumptions.push(
        `Assumes an additional purchase outflow of ${formatMoney(change.amount)} for "${change.label}" on ${change.date}.`,
      );
      break;
    }

    default: {
      throw new EngineError(
        'INVALID_INPUT',
        `Unsupported scenario change type: ${(change as ScenarioChange).type}`,
      );
    }
  }

  // scenario = forecast(modified copy)
  const scenarioInput: ForecastInput = {
    ...input,
    obligations: modifiedObligations,
    receipts: modifiedReceipts,
  };
  const scenario = forecast(scenarioInput);

  const lowestDelta = scenario.lowest.amount - baseline.lowest.amount;
  const shortfallDelta = scenario.shortfall - baseline.shortfall;
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

