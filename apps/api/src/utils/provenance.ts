import type { ActionRecord } from '@settle/shared';

export interface ActionWithProvenance extends ActionRecord {
  reasonDisplay: string;
  reasonSource?: string;
}

/**
 * Extracts provenance tag (e.g. "[via rules; path=rules]" or "[via provider=...; model=...]")
 * and computes:
 * - reasonDisplay: the reason text without the trailing provenance tag
 * - reasonSource: the tag text (e.g. "[via rules; path=rules]")
 *
 * Leaves stored ActionRecord.reason untouched.
 */
export function enrichActionWithDisplayFields<T extends ActionRecord>(
  action: T,
): T & { reasonDisplay: string; reasonSource?: string } {
  const reason = action.reason || '';
  const match = reason.match(/\[via\s+[^\]]+\]/);

  if (!match) {
    return {
      ...action,
      reasonDisplay: reason,
    };
  }

  const tag = match[0];
  // Remove the tag and normalize whitespace
  const reasonDisplay = reason.replace(/\s*\[via\s+[^\]]+\]/, '').trim();

  return {
    ...action,
    reasonDisplay,
    reasonSource: tag,
  };
}
