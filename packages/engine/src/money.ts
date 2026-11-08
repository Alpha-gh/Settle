import type { Cents } from '@settle/shared';
import { EngineError } from './errors.js';

export function assertCents(cents: unknown): asserts cents is Cents {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) {
    throw new EngineError('INVALID_INPUT', `Expected cents to be a safe integer, got ${cents}`);
  }
}

export function roundHalfUpDiv(n: number, d: number): number {
  assertCents(n);
  assertCents(d);

  if (d === 0) {
    throw new EngineError('INVALID_INPUT', 'Division by zero');
  }

  let num = n;
  let den = d;
  if (den < 0) {
    num = -num;
    den = -den;
  }

  const bn = BigInt(num);
  const bd = BigInt(den);

  let q = bn / bd;
  const rem = bn % bd;

  if (bn >= 0n) {
    if (2n * rem >= bd) {
      q += 1n;
    }
  } else {
    // Negative remainder: rem is in (-bd, 0]
    // Half-up rounding rounds ties (.5) towards +infinity.
    if (2n * (-rem) > bd) {
      q -= 1n;
    }
  }

  const result = Number(q);
  assertCents(result);
  return result;
}

export function applyDiscount(amount: Cents, pct: number): Cents {
  assertCents(amount);
  if (amount < 0) {
    throw new EngineError('INVALID_INPUT', `Amount must be non-negative, got ${amount}`);
  }

  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new EngineError(
      'INVALID_INPUT',
      `Discount percentage must be between 0 and 100, got ${pct}`,
    );
  }

  const bps = Math.round(pct * 100);
  if (bps < 0 || bps > 10_000) {
    throw new EngineError('INVALID_INPUT', `Basis points outside 0..10000: ${bps}`);
  }

  const remainingBps = 10_000 - bps;
  const numerator = amount * remainingBps;
  return roundHalfUpDiv(numerator, 10_000);
}

