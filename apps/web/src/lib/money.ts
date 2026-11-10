import type { Cents } from '@settle/shared';

/**
 * Parses a dollar string into integer cents using string parsing only.
 * Strictly adheres to AGENT_RULES (Rule 2 & 3):
 * - NO parseFloat, NO floating-point arithmetic.
 * - Rejects negatives, more than 2 decimal places, and non-numeric inputs.
 * - Supports comma thousands grouping (e.g., "1,000.50").
 * - Supports fractional strings like ".5" or "0.5".
 */
export function parseDollarsToCents(input: string): Cents | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  // Reject negative numbers explicitly
  if (trimmed.startsWith('-')) {
    return null;
  }

  // Remove valid commas used for grouping
  const cleaned = trimmed.replace(/,/g, '');

  // Must match integer or decimal with 1 or 2 digits after the dot
  // Disallows multiple dots, non-digits, more than 2 decimal digits
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(cleaned) || cleaned === '.') {
    return null;
  }

  const parts = cleaned.split('.');
  const wholeStr = parts[0] ?? '';
  const fracStr = parts[1] ?? '';

  // If there are more than 2 parts, invalid
  if (parts.length > 2) {
    return null;
  }

  let wholeCents = 0;
  if (wholeStr.length > 0) {
    // Parse whole digits using parseInt with radix 10
    const parsedWhole = parseInt(wholeStr, 10);
    if (!Number.isSafeInteger(parsedWhole) || parsedWhole < 0) {
      return null;
    }
    wholeCents = parsedWhole * 100;
  }

  let fracCents = 0;
  if (fracStr.length === 1) {
    fracCents = parseInt(fracStr, 10) * 10;
  } else if (fracStr.length === 2) {
    fracCents = parseInt(fracStr, 10);
  } else if (fracStr.length > 2) {
    return null;
  }

  const totalCents = wholeCents + fracCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return null;
  }

  return totalCents;
}

/**
 * Formats integer cents into a plain decimal dollar string suitable for form inputs.
 * Uses integer math only: Math.trunc(cents / 100) and cents % 100.
 */
export function centsToDollarsString(cents: Cents): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return '0.00';
  }
  const dollars = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${remainder.toString().padStart(2, '0')}`;
}

