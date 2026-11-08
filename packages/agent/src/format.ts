import type { Cents, ISODate } from '@settle/shared';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

/**
 * Format integer cents into USD currency string (e.g. 123456 -> "$1,234.56").
 * Uses only integer division and modulo with zero floating point operations.
 */
export function formatUsd(cents: Cents): string {
  const isNegative = cents < 0;
  const absCents = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(absCents / 100);
  const remainingCents = absCents % 100;

  const dollarsFormatted = dollars
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const centsFormatted = remainingCents.toString().padStart(2, '0');

  const sign = isNegative ? '-' : '';
  return `${sign}$${dollarsFormatted}.${centsFormatted}`;
}

/**
 * Format a percentage number into a display string (e.g. 3 -> "3%").
 */
export function formatPercent(pct: number): string {
  return `${pct}%`;
}

/**
 * Validate and format an ISO date string (YYYY-MM-DD).
 */
export function formatIsoDate(date: ISODate): string {
  return date;
}

/**
 * Format an ISO date (YYYY-MM-DD) into a human readable display format (e.g. "Nov 5, 2026")
 * without using Date objects.
 */
export function formatDateDisplay(date: ISODate): string {
  const parts = date.split('-');
  const year = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];

  if (!year || !monthStr || !dayStr) {
    return date;
  }

  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIdx];
  if (!monthName) {
    return date;
  }

  const day = parseInt(dayStr, 10);
  return `${monthName} ${day}, ${year}`;
}

