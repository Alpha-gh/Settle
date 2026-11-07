import { describe, it, expect } from 'vitest';
import { parseDollarsToCents, centsToDollarsString } from './money';
import { formatUsd } from './format';

describe('parseDollarsToCents', () => {
  describe('Valid dollar inputs', () => {
    it('parses whole integer dollars', () => {
      expect(parseDollarsToCents('10')).toBe(1000);
      expect(parseDollarsToCents('0')).toBe(0);
      expect(parseDollarsToCents('500')).toBe(50000);
    });

    it('parses decimal dollars with 1 decimal digit', () => {
      expect(parseDollarsToCents('10.5')).toBe(1050);
      expect(parseDollarsToCents('0.5')).toBe(50);
      expect(parseDollarsToCents('.5')).toBe(50);
    });

    it('parses decimal dollars with 2 decimal digits', () => {
      expect(parseDollarsToCents('10.50')).toBe(1050);
      expect(parseDollarsToCents('10.05')).toBe(1005);
      expect(parseDollarsToCents('0.05')).toBe(5);
      expect(parseDollarsToCents('.05')).toBe(5);
      expect(parseDollarsToCents('1000.50')).toBe(100050);
    });

    it('parses comma-grouped values', () => {
      expect(parseDollarsToCents('1,000.50')).toBe(100050);
      expect(parseDollarsToCents('1,234,567.89')).toBe(123456789);
    });

    it('handles leading zeros properly', () => {
      expect(parseDollarsToCents('010.50')).toBe(1050);
      expect(parseDollarsToCents('005')).toBe(500);
    });

    it('handles leading and trailing whitespace', () => {
      expect(parseDollarsToCents('  25.00  ')).toBe(2500);
    });
  });

  describe('Invalid inputs (returns null)', () => {
    it('rejects values with more than 2 decimal places', () => {
      expect(parseDollarsToCents('12.345')).toBeNull();
      expect(parseDollarsToCents('1.001')).toBeNull();
      expect(parseDollarsToCents('0.123456')).toBeNull();
    });

    it('rejects negative numbers', () => {
      expect(parseDollarsToCents('-10')).toBeNull();
      expect(parseDollarsToCents('-10.50')).toBeNull();
      expect(parseDollarsToCents('-0.05')).toBeNull();
    });

    it('rejects non-numeric characters', () => {
      expect(parseDollarsToCents('abc')).toBeNull();
      expect(parseDollarsToCents('$10.00')).toBeNull();
      expect(parseDollarsToCents('10 dollars')).toBeNull();
      expect(parseDollarsToCents('10.50 USD')).toBeNull();
    });

    it('rejects empty or malformed input', () => {
      expect(parseDollarsToCents('')).toBeNull();
      expect(parseDollarsToCents('   ')).toBeNull();
      expect(parseDollarsToCents('.')).toBeNull();
      expect(parseDollarsToCents('10.')).toBeNull();
      expect(parseDollarsToCents('1.2.3')).toBeNull();
    });
  });

  describe('Round-trip testing with formatting', () => {
    it('round-trips through centsToDollarsString and parseDollarsToCents', () => {
      const testCents = [0, 5, 50, 100, 1050, 50000, 100050, 99999999];
      for (const cents of testCents) {
        const str = centsToDollarsString(cents);
        const parsed = parseDollarsToCents(str);
        expect(parsed).toBe(cents);
      }
    });

    it('round-trips through formatUsd and parseDollarsToCents', () => {
      const testCents = [0, 5, 50, 100, 1050, 50000, 100050];
      for (const cents of testCents) {
        const formatted = formatUsd(cents); // e.g. "$1,000.50"
        const stripped = formatted.replace('$', ''); // e.g. "1,000.50"
        const parsed = parseDollarsToCents(stripped);
        expect(parsed).toBe(cents);
      }
    });
  });
});

