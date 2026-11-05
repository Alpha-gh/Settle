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
 * Generates a deterministic templated explanation quoting strictly formatted facts.
 * Fits within the 280 character limit.
 */
export function templatedReason(candidate: Candidate, invoice: Invoice): string {
  const remaining = invoice.amount - invoice.amountPaid;
  const remainingFormatted = formatUsd(remaining);
  const costFormatted = formatUsd(candidate.cashCost);
  const deltaFormatted = formatUsd(candidate.lowestDelta);

  if (candidate.id === 'escalate') {
    return `Escalating invoice ${invoice.number} (${remainingFormatted} due ${invoice.dueDate}): no auto-recovery path closed the gap.`;
  }

  if (candidate.closesGap) {
    return `Selected ${candidate.id} (${candidate.change.type}) for ${invoice.number}: closes cashflow gap at lowest cash cost ${costFormatted} with delta ${deltaFormatted}.`;
  }

  return `Selected ${candidate.id} (${candidate.change.type}) for ${invoice.number}: yields largest delta ${deltaFormatted} with cash cost ${costFormatted}.`;
}
