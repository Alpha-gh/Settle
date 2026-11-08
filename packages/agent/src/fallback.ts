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

  // Else largest lowestDelta
  indexed.sort((a, b) => {
    if (a.cand.lowestDelta !== b.cand.lowestDelta) {
      return b.cand.lowestDelta - a.cand.lowestDelta;
    }
    return a.index - b.index;
  });

  return indexed[0]!.cand;
}

/**
 * Generates a deterministic templated explanation quoting strictly formatted facts
 * in natural, owner-friendly language without internal IDs.
 * Fits within the 280 character limit.
 */
export function templatedReason(candidate: Candidate, invoice: Invoice): string {
  const remaining = invoice.amount - invoice.amountPaid;
  const remainingFormatted = formatUsd(remaining);
  const costFormatted = formatUsd(candidate.cashCost);
  const deltaFormatted = formatUsd(candidate.lowestDelta);

  if (candidate.id === 'escalate') {
    return `Escalating invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) for manual collection because no automated recovery closes the gap.`;
  }

  if (candidate.closesGap) {
    if (candidate.change.type === 'REMIND') {
      return `Sending reminder for invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) to recover cash and close the cashflow gap.`;
    }
    if (candidate.change.type === 'OFFER_DISCOUNT') {
      return `Offering a ${candidate.change.discountPct}% discount on invoice ${invoice.number} to accelerate ${deltaFormatted} at a cost of ${costFormatted}, closing the cashflow gap.`;
    }
    if (candidate.change.type === 'OFFER_INSTALMENTS') {
      return `Offering ${candidate.change.count} instalments spaced ${candidate.change.spacingDays} days on invoice ${invoice.number} to recover ${remainingFormatted} and close the gap.`;
    }
    return `Applying ${candidate.change.type} on invoice ${invoice.number} (${remainingFormatted}) to improve balance by ${deltaFormatted} at cost ${costFormatted}, closing the gap.`;
  }

  // Does not close gap
  if (candidate.change.type === 'REMIND') {
    return `Sending reminder for invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}) to recover cash and improve balance by ${deltaFormatted}.`;
  }
  if (candidate.change.type === 'OFFER_DISCOUNT') {
    return `Offering a ${candidate.change.discountPct}% discount on invoice ${invoice.number} to accelerate ${deltaFormatted} at a cost of ${costFormatted}.`;
  }
  if (candidate.change.type === 'OFFER_INSTALMENTS') {
    return `Offering ${candidate.change.count} instalments spaced ${candidate.change.spacingDays} days on invoice ${invoice.number} to improve cash by ${deltaFormatted}.`;
  }
  return `Applying ${candidate.change.type} on invoice ${invoice.number} (${remainingFormatted}) to improve balance by ${deltaFormatted} at cost ${costFormatted}.`;
}
