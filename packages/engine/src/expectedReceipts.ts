import type { Confidence, ExpectedReceipt, Invoice, ISODate, Payer } from '@settle/shared';
import { addDays, assertISODate, compareISO } from './dates.js';
import { EngineError } from './errors.js';
import { applyDiscount, assertCents } from './money.js';

export function expectedReceipts(
  invoices: Invoice[],
  payers: Payer[],
  asOf: ISODate,
): ExpectedReceipt[] {
  assertISODate(asOf);

  if (!Array.isArray(invoices)) {
    throw new EngineError('INVALID_INPUT', 'invoices must be an array');
  }

  if (!Array.isArray(payers)) {
    throw new EngineError('INVALID_INPUT', 'payers must be an array');
  }

  const payerMap = new Map<string, Payer>();
  for (const payer of payers) {
    if (!payer || typeof payer !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Payer must be a non-null object');
    }
    payerMap.set(payer.id, payer);
  }

  const receipts: ExpectedReceipt[] = [];

  for (const inv of invoices) {
    if (!inv || typeof inv !== 'object') {
      throw new EngineError('INVALID_INPUT', 'Invoice must be a non-null object');
    }

    // Only invoices with status SENT or PARTIALLY_PAID. DRAFT, PAID, CANCELLED, REFUNDED produce nothing.
    if (inv.status !== 'SENT' && inv.status !== 'PARTIALLY_PAID') {
      continue;
    }

    const payer = payerMap.get(inv.payerId);
    if (!payer) {
      throw new EngineError('NOT_FOUND', `Payer not found for invoice ${inv.id}`);
    }

    assertCents(inv.amount);
    assertCents(inv.amountPaid);
    assertISODate(inv.dueDate);

    // remaining = applyDiscount(amount, discountPct) - amountPaid (half-up, integer math); skip if remaining <= 0.
    const discountedAmount = applyDiscount(inv.amount, inv.discountPct ?? 0);
    const remaining = discountedAmount - inv.amountPaid;
    if (remaining <= 0) {
      continue;
    }

    let confidence: Confidence;
    let date: ISODate;

    switch (payer.persona) {
      case 'reliable': {
        confidence = 'expected';
        const avgLate = Math.round(payer.avgDaysLate);
        const projected = addDays(inv.dueDate, avgLate);
        date = compareISO(projected, asOf) < 0 ? asOf : projected;
        break;
      }
      case 'slow': {
        confidence = payer.avgDaysLate <= 14 ? 'expected' : 'uncertain';
        const avgLate = Math.round(payer.avgDaysLate);
        const projected = addDays(inv.dueDate, avgLate);
        date = compareISO(projected, asOf) < 0 ? asOf : projected;
        break;
      }
      case 'chronic': {
        confidence = 'uncertain';
        const avgLate = Math.round(payer.avgDaysLate);
        const projected = addDays(inv.dueDate, avgLate);
        date = compareISO(projected, asOf) < 0 ? asOf : projected;
        break;
      }
      case 'ghost': {
        confidence = 'uncertain';
        date = addDays(asOf, 90);
        break;
      }
      default: {
        throw new EngineError(
          'INVALID_INPUT',
          `Unknown payer persona "${(payer as Payer).persona}" for invoice ${inv.id}`,
        );
      }
    }

    receipts.push({
      invoiceId: inv.id,
      amount: remaining,
      date,
      confidence,
    });
  }

  // Output sorted by (date, invoiceId) for determinism
  receipts.sort((a, b) => {
    const cmp = compareISO(a.date, b.date);
    if (cmp !== 0) return cmp;
    return a.invoiceId.localeCompare(b.invoiceId);
  });

  return receipts;
}

