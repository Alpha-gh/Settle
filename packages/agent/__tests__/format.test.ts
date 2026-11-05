import { describe, expect, it } from 'vitest';
import {
  formatDateDisplay,
  formatIsoDate,
  formatPercent,
  formatUsd,
} from '../src/format.js';

describe('format', () => {
  it('formatUsd formats exact cents without floating point arithmetic', () => {
    expect(formatUsd(123456)).toBe('$1,234.56');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(100000000)).toBe('$1,000,000.00');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(99)).toBe('$0.99');
    expect(formatUsd(100)).toBe('$1.00');
    expect(formatUsd(-500)).toBe('-$5.00');
    expect(formatUsd(-5)).toBe('-$0.05');
  });

  it('formatPercent formats number with percent sign', () => {
    expect(formatPercent(5)).toBe('5%');
    expect(formatPercent(3)).toBe('3%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('formatIsoDate passes through valid ISO date string', () => {
    expect(formatIsoDate('2026-11-05')).toBe('2026-11-05');
  });

  it('formatDateDisplay formats ISO date without Date constructor', () => {
    expect(formatDateDisplay('2026-11-05')).toBe('Nov 5, 2026');
    expect(formatDateDisplay('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDateDisplay('2026-12-31')).toBe('Dec 31, 2026');
  });
});

