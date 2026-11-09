import type { Invoice } from '@settle/shared';
import { formatUsd } from './format.js';
import type { Candidate } from './options.js';

/**
 * Deterministically select a candidate option:
 * - If baseline has no breach: lowest cashCost
 * - Else if any closesGap: lowest cashCost among those that close the gap
 * - Else: largest lowestDelta
 * - Ties broken by lowest opt index (original order in candidates)
 */
export function deterministicChoice(candidates: Candidate[]): Candidate {
  if (candidates.length === 0) {
    throw new Error('deterministicChoice called with zero candidates');
  }

  const indexed = candidates.map((cand, index) => ({ cand, index }));
  const hasBreach = candidates[0]?.baselineFirstBreachDate !== null;

  if (!hasBreach) {
    // If baseline has no breach: lowest cashCost
    indexed.sort((a, b) => {
      if (a.cand.cashCost !== b.cand.cashCost) {
        return a.cand.cashCost - b.cand.cashCost;
      }
      return a.index - b.index;
    });
    return indexed[0]!.cand;
  }

  const closing = indexed.filter((item) => item.cand.closesGap);
  if (closing.length > 0) {
    // Lowest cashCost where closesGap
    closing.sort((a, b) => {
      if (a.cand.cashCost !== b.cand.cashCost) {
        return a.cand.cashCost - b.cand.cashCost;
      }
      return a.index - b.index;
    });
    return closing[0]!.cand;
  }

  // Else largest lowestDelta, ties broken by lowest cashCost, then index
  indexed.sort((a, b) => {
    if (a.cand.lowestDelta !== b.cand.lowestDelta) {
      return b.cand.lowestDelta - a.cand.lowestDelta;
    }
    if (a.cand.cashCost !== b.cand.cashCost) {
      return a.cand.cashCost - b.cand.cashCost;
    }
    return a.index - b.index;
  });

  return indexed[0]!.cand;
}

/**
 * Generates a deterministic templated explanation quoting strictly formatted facts
 * in natural, owner-friendly language without internal IDs.
 * Plain English, 1-2 sentences, <= 240 characters.
 */
export function templatedReason(candidate: Candidate, invoice: Invoice): string {
  const remaining = invoice.amount - invoice.amountPaid;
  const remainingFormatted = formatUsd(remaining);
  const payerName = candidate.payerName;

  if (candidate.id === 'escalate' || candidate.change.type === ('ESCALATE' as any)) {
    return `Escalate invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) for ${payerName} to the owner for manual collection.`;
  }

  if (candidate.change.type === 'REMIND') {
    return `Send a reminder to ${payerName} for invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) to prompt on-time settlement.`;
  }

  if (candidate.change.type === 'OFFER_DISCOUNT') {
    const discounted = remaining - candidate.cashCost;
    const discountedFormatted = formatUsd(discounted);
    const expectedDate = candidate.change.newExpectedDate ?? invoice.dueDate;
    return `Offer a ${candidate.change.discountPct}% early-payment discount to ${payerName} on invoice ${invoice.number} to accelerate ${discountedFormatted} due ${expectedDate}.`;
  }

  if (candidate.change.type === 'OFFER_INSTALMENTS') {
    const firstDate = candidate.change.firstDate ?? invoice.dueDate;
    return `Split invoice ${invoice.number} for ${payerName} into ${candidate.change.count} instalments to recover ${remainingFormatted} starting ${firstDate}.`;
  }

  return `Apply payment arrangement for invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) with ${payerName}.`;
}
