import type {
  ActionRecord,
  Cents,
  Invoice,
  ISODate,
  Payer,
} from '@settle/shared';
import { addDays } from '../clock.js';
import { formatUsd } from '../format.js';

/**
 * ROUNDING RULE DOCUMENTATION:
 * 1. Discount rounding: Math.round(remaining * (1 - discountPct / 100))
 *    Uses integer round-half-up standard.
 * 2. Instalments rounding:
 *    base = Math.floor(remaining / count);
 *    remainder = remaining - base * count;
 *    firstInstalment = base + remainder;
 *    Any remainder from integer division is front-loaded onto the first instalment.
 *
 * System 1 and System 2 should use identical integer rounding logic.
 */

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface PayerResponse {
  responds: boolean;
  accepts: boolean;
  payAmount: Cents;
  payDate: ISODate;
  message: string;
}

export function simulatePayerResponse(
  action: ActionRecord,
  invoice: Invoice,
  payer: Payer,
  seed: number,
): PayerResponse {
  const combinedSeed = seed + stableHash(invoice.id);
  const rng = mulberry32(combinedSeed);

  // Today is the date part of action.createdAt (YYYY-MM-DD)
  const today = (action.createdAt ? action.createdAt.slice(0, 10) : '2026-11-05') as ISODate;
  const remaining = Math.max(0, invoice.amount - invoice.amountPaid);

  // ESCALATE and NO_ACTION never get a payer response
  if (action.type === 'ESCALATE' || action.type === 'NO_ACTION') {
    return {
      responds: false,
      accepts: false,
      payAmount: 0,
      payDate: today,
      message: 'No response.',
    };
  }

  // Ghost never pays
  if (payer.persona === 'ghost') {
    return {
      responds: false,
      accepts: false,
      payAmount: 0,
      payDate: today,
      message: 'No response.',
    };
  }

  // Reliable persona: pays within 0..2 days of REMIND or discount/instalments
  if (payer.persona === 'reliable') {
    const delayDays = Math.floor(rng() * 3); // 0, 1, or 2 days
    const payDate = addDays(today, delayDays);

    let payAmount = remaining;
    if (action.type === 'OFFER_DISCOUNT' && action.params.discountPct) {
      payAmount = Math.round(remaining * (1 - action.params.discountPct / 100));
    } else if (action.type === 'OFFER_INSTALMENTS' && action.params.instalments) {
      const count = Math.max(2, action.params.instalments.count);
      const base = Math.floor(remaining / count);
      const remainder = remaining - base * count;
      payAmount = base + remainder;
    }

    return {
      responds: true,
      accepts: true,
      payAmount,
      payDate,
      message: `We will settle ${formatUsd(payAmount)} on ${payDate}.`,
    };
  }

  // Slow persona
  if (payer.persona === 'slow') {
    // Accepts OFFER_DISCOUNT if discountPct >= 2
    if (
      action.type === 'OFFER_DISCOUNT' &&
      action.params.discountPct !== undefined &&
      action.params.discountPct >= 2
    ) {
      const delayDays = Math.floor(rng() * 4); // 0..3 days
      const payDate = addDays(today, delayDays);
      const payAmount = Math.round(
        remaining * (1 - action.params.discountPct / 100),
      );

      return {
        responds: true,
        accepts: true,
        payAmount,
        payDate,
        message: `We accept the discount offer and will pay ${formatUsd(payAmount)} on ${payDate}.`,
      };
    }

    // Responds to REMIND, but does not accept payment immediately
    if (action.type === 'REMIND') {
      return {
        responds: true,
        accepts: false,
        payAmount: 0,
        payDate: today,
        message: `We acknowledge receipt of reminder for invoice ${invoice.number} and will process payment shortly.`,
      };
    }

    // Chronic / other offers are ignored by slow persona
    return {
      responds: false,
      accepts: false,
      payAmount: 0,
      payDate: today,
      message: 'No response.',
    };
  }

  // Chronic persona
  if (payer.persona === 'chronic') {
    // Accepts OFFER_INSTALMENTS
    if (action.type === 'OFFER_INSTALMENTS' && action.params.instalments) {
      const delayDays = Math.floor(rng() * 3); // 0..2 days
      const payDate = addDays(today, delayDays);
      const count = Math.max(2, action.params.instalments.count);
      const base = Math.floor(remaining / count);
      const remainder = remaining - base * count;
      const payAmount = base + remainder;

      return {
        responds: true,
        accepts: true,
        payAmount,
        payDate,
        message: `We accept the instalment schedule and will submit our first payment of ${formatUsd(payAmount)} on ${payDate}.`,
      };
    }

    // Ignores REMIND and OFFER_DISCOUNT
    return {
      responds: false,
      accepts: false,
      payAmount: 0,
      payDate: today,
      message: 'No response.',
    };
  }

  // Default fallback
  return {
    responds: false,
    accepts: false,
    payAmount: 0,
    payDate: today,
    message: 'No response.',
  };
}

