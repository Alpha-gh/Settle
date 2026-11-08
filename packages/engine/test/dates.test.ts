import { describe, expect, it } from 'vitest';
import { addDays, assertISODate, compareISO, diffDays, formatISO, parseISO } from '../src/dates.js';
import { EngineError } from '../src/errors.js';

describe('dates', () => {
  describe('parseISO', () => {
    it('parses valid ISO calendar dates correctly', () => {
      const d = parseISO('2026-03-01');
      expect(d.getUTCFullYear()).toBe(2026);
      expect(d.getUTCMonth()).toBe(2); // March is index 2
      expect(d.getUTCDate()).toBe(1);
    });

    it('correctly handles leap year 2024-02-29', () => {
      const d = parseISO('2024-02-29');
      expect(d.getUTCFullYear()).toBe(2024);
      expect(d.getUTCMonth()).toBe(1);
      expect(d.getUTCDate()).toBe(29);
    });

    it('rejects invalid calendar dates strictly (e.g. 2026-02-30, 2026-02-29, 2026-04-31)', () => {
      const invalidDates = [
        '2026-02-30',
        '2026-02-29', // 2026 is not a leap year
        '2026-04-31', // April has 30 days
        '2026-13-01', // Month 13
        '2026-00-10', // Month 0
        '2026-01-00', // Day 0
        '2026-01-32', // Day 32
        '2026/01/01', // Wrong separator
        '2026-1-1',   // Missing leading zeros
        'not-a-date',
        '',
      ];

      for (const invalid of invalidDates) {
        expect(() => parseISO(invalid)).toThrowError(EngineError);
        try {
          parseISO(invalid);
        } catch (err) {
          expect(err).toBeInstanceOf(EngineError);
          expect((err as EngineError).code).toBe('INVALID_INPUT');
        }
      }
    });

    it('rejects non-string inputs', () => {
      expect(() => parseISO(123 as unknown as string)).toThrowError(EngineError);
      expect(() => parseISO(null as unknown as string)).toThrowError(EngineError);
    });
  });

  describe('formatISO', () => {
    it('formats a UTC date to YYYY-MM-DD', () => {
      const d = new Date(Date.UTC(2026, 0, 5));
      expect(formatISO(d)).toBe('2026-01-05');
    });
  });

  describe('assertISODate', () => {
    it('asserts valid ISO strings and throws on invalid or non-string', () => {
      expect(() => assertISODate('2026-03-01')).not.toThrow();
      expect(() => assertISODate(12345)).toThrowError(EngineError);
      expect(() => assertISODate('2026-02-30')).toThrowError(EngineError);
    });
  });

  describe('addDays', () => {
    it('adds positive days across month and year boundaries', () => {
      expect(addDays('2026-01-30', 2)).toBe('2026-02-01');
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('adds negative days (subtracts days)', () => {
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('rejects non-integer days', () => {
      expect(() => addDays('2026-01-01', 1.5)).toThrowError(EngineError);
    });
  });

  describe('diffDays', () => {
    it('calculates the exact day difference between two ISO dates', () => {
      expect(diffDays('2026-03-05', '2026-03-01')).toBe(4);
      expect(diffDays('2026-03-01', '2026-03-05')).toBe(-4);
      expect(diffDays('2026-03-01', '2026-03-01')).toBe(0);
    });
  });

  describe('compareISO', () => {
    it('compares two ISO dates lexicographically after validating', () => {
      expect(compareISO('2026-01-01', '2026-01-02')).toBe(-1);
      expect(compareISO('2026-01-02', '2026-01-01')).toBe(1);
      expect(compareISO('2026-01-01', '2026-01-01')).toBe(0);
    });
  });
});
