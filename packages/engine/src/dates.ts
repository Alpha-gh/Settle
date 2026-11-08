import type { ISODate } from '@settle/shared';
import { EngineError } from './errors.js';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISO(iso: string): Date {
  if (typeof iso !== 'string') {
    throw new EngineError('INVALID_INPUT', `Expected ISO date string, got ${typeof iso}`);
  }

  const match = ISO_DATE_REGEX.exec(iso);
  if (!match) {
    throw new EngineError('INVALID_INPUT', `Invalid ISO date format: "${iso}". Expected YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new EngineError('INVALID_INPUT', `Invalid month in date: "${iso}"`);
  }

  if (day < 1 || day > 31) {
    throw new EngineError('INVALID_INPUT', `Invalid day in date: "${iso}"`);
  }

  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new EngineError('INVALID_INPUT', `Invalid calendar date: "${iso}"`);
  }

  return date;
}

export function formatISO(date: Date): ISODate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function assertISODate(iso: unknown): asserts iso is ISODate {
  if (typeof iso !== 'string') {
    throw new EngineError('INVALID_INPUT', `Expected ISO date string, got ${typeof iso}`);
  }
  parseISO(iso);
}

export function addDays(iso: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) {
    throw new EngineError('INVALID_INPUT', `addDays requires integer days, got ${days}`);
  }
  const date = parseISO(iso);
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
  return formatISO(new Date(utc));
}

export function diffDays(a: ISODate, b: ISODate): number {
  const da = parseISO(a);
  const db = parseISO(b);
  const diffMs = da.getTime() - db.getTime();
  return Math.round(diffMs / 86_400_000);
}

export function compareISO(a: ISODate, b: ISODate): number {
  parseISO(a);
  parseISO(b);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
