import { describe, expect, it } from 'vitest';
import { applyDiscount, assertCents, roundHalfUpDiv } from '../src/money.js';
import { EngineError } from '../src/errors.js';

describe('money', () => {
  describe('assertCents', () => {
    it('accepts safe integer cents (positive, zero, negative)', () => {
      expect(() => assertCents(0)).not.toThrow();
      expect(() => assertCents(100)).not.toThrow();
      expect(() => assertCents(-500)).not.toThrow();
      expect(() => assertCents(Number.MAX_SAFE_INTEGER)).not.toThrow();
    });

    it('rejects floats, non-integers, NaN, and Infinity', () => {
      const invalid = [1.5, 0.1, -2.4, NaN, Infinity, -Infinity, '100', null, undefined];
      for (const val of invalid) {
        expect(() => assertCents(val)).toThrowError(EngineError);
        try {
          assertCents(val);
        } catch (err) {
          expect(err).toBeInstanceOf(EngineError);
          expect((err as EngineError).code).toBe('INVALID_INPUT');
        }
      }
    });
  });

  describe('roundHalfUpDiv', () => {
    it('performs exact integer division with half-up rounding', () => {
      // 1 / 2 = 0.5 -> 1
      expect(roundHalfUpDiv(1, 2)).toBe(1);
      // 0 / 2 = 0
      expect(roundHalfUpDiv(0, 2)).toBe(0);
      // 2 / 2 = 1
      expect(roundHalfUpDiv(2, 2)).toBe(1);
      // 3 / 2 = 1.5 -> 2
      expect(roundHalfUpDiv(3, 2)).toBe(2);

      // Denominator 100
      expect(roundHalfUpDiv(49, 100)).toBe(0);
      expect(roundHalfUpDiv(50, 100)).toBe(1);
      expect(roundHalfUpDiv(51, 100)).toBe(1);
      expect(roundHalfUpDiv(149, 100)).toBe(1);
      expect(roundHalfUpDiv(150, 100)).toBe(2);

      // Negative divisor
      expect(roundHalfUpDiv(1, -2)).toBe(0); // -0.5 rounds half-up to 0
      expect(roundHalfUpDiv(3, -2)).toBe(-1); // -1.5 rounds half-up to -1
      expect(roundHalfUpDiv(-3, 2)).toBe(-1); // -1.5 rounds half-up to -1
      expect(roundHalfUpDiv(-4, 2)).toBe(-2);
      expect(roundHalfUpDiv(-5, 2)).toBe(-2); // -2.5 rounds half-up to -2
      expect(roundHalfUpDiv(-5, 3)).toBe(-2); // -1.666... rounds to -2
    });

    it('throws EngineError on division by zero', () => {
      expect(() => roundHalfUpDiv(100, 0)).toThrowError(EngineError);
      try {
        roundHalfUpDiv(100, 0);
      } catch (err) {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).code).toBe('INVALID_INPUT');
      }
    });
  });

  describe('applyDiscount', () => {
    it('calculates discount using basis points and integer arithmetic with half-up rounding', () => {
      // $10.00 (1000 cents) with 5% discount = $9.50 (950 cents)
      expect(applyDiscount(1000, 5)).toBe(950);

      // $1.00 (100 cents) with 0% discount = $1.00 (100 cents)
      expect(applyDiscount(100, 0)).toBe(100);

      // $1.00 (100 cents) with 100% discount = $0.00 (0 cents)
      expect(applyDiscount(100, 100)).toBe(0);

      // $1.00 (100 cents) with 2.5% discount:
      // bps = 250, remainingBps = 9750, 100 * 9750 = 975,000 / 10,000 = 97.5 -> 98 cents
      expect(applyDiscount(100, 2.5)).toBe(98);

      // $1.00 (100 cents) with 2.4% discount:
      // bps = 240, remainingBps = 9760, 100 * 9760 = 976,000 / 10,000 = 97.6 -> 98 cents
      expect(applyDiscount(100, 2.4)).toBe(98);

      // $1.00 (100 cents) with 2.6% discount:
      // bps = 260, remainingBps = 9740, 100 * 9740 = 974,000 / 10,000 = 97.4 -> 97 cents
      expect(applyDiscount(100, 2.6)).toBe(97);
    });

    it('rejects percentages outside 0..100, NaN, and negative amounts', () => {
      expect(() => applyDiscount(100, -1)).toThrowError(EngineError);
      expect(() => applyDiscount(100, 100.1)).toThrowError(EngineError);
      expect(() => applyDiscount(100, NaN)).toThrowError(EngineError);
      expect(() => applyDiscount(100, Infinity)).toThrowError(EngineError);
      expect(() => applyDiscount(-50, 5)).toThrowError(EngineError);
    });
  });
});
