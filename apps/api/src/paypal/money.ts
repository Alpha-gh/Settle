import type { Cents } from '@settle/shared';

/**
 * Converts integer cents to PayPal decimal string without floating point arithmetic.
 * e.g. 25000 -> "250.00", 5 -> "0.05", 0 -> "0.00", -2500 -> "-25.00"
 */
export function centsToPayPalString(cents: Cents): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Cents must be an integer, got: ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/**
 * Converts PayPal decimal string to integer cents without floating point arithmetic.
 * e.g. "250.00" -> 25000, "0.05" -> 5, "0.00" -> 0, "-25.00" -> -2500, "100" -> 10000
 */
export function payPalStringToCents(value: string): Cents {
  if (typeof value !== 'string') {
    throw new Error(`Expected string value, got: ${typeof value}`);
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid PayPal money string: "${value}"`);
  }

  const isNegative = match[1] === '-';
  const dollarPart = parseInt(match[2], 10);
  const fracRaw = match[3] ?? '';

  if (fracRaw.length > 2) {
    throw new Error(`PayPal USD amount cannot have more than 2 decimal places: "${value}"`);
  }

  const fracPart = parseInt(fracRaw.padEnd(2, '0') || '0', 10);
  const totalCents = dollarPart * 100 + fracPart;

  return isNegative ? -totalCents : totalCents;
}

