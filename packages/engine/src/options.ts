import type { ForecastInput, Invoice, Payer, Policy, ScenarioChange } from '@settle/shared';
import { addDays, assertISODate } from './dates.js';
import { applyDiscount, assertCents } from './money.js';

export function generateOptions(
  input: ForecastInput,
  invoice: Invoice,
  payer: Payer,
  policy: Policy,
): ScenarioChange[] {
  // Return [] if the invoice is not SENT/PARTIALLY_PAID
  if (invoice.status !== 'SENT' && invoice.status !== 'PARTIALLY_PAID') {
    return [];
  }

  assertCents(invoice.amount);
  assertCents(invoice.amountPaid);
  const remaining = applyDiscount(invoice.amount, invoice.discountPct ?? 0) - invoice.amountPaid;
  if (remaining <= 0) {
    return [];
  }

  // Ghost payer: return [] (the agent escalates)
  if (payer.persona === 'ghost') {
    return [];
  }

  assertISODate(input.business.asOf);
  const asOf = input.business.asOf;
  const options: ScenarioChange[] = [];

  // REMIND by persona: reliable asOf+2, slow asOf+7, chronic asOf+14
  let remindDays: number;
  switch (payer.persona) {
    case 'reliable':
      remindDays = 2;
      break;
    case 'slow':
      remindDays = 7;
      break;
    case 'chronic':
      remindDays = 14;
      break;
    default:
      return [];
  }

  options.push({
    type: 'REMIND',
    invoiceId: invoice.id,
    newExpectedDate: addDays(asOf, remindDays),
  });

  // OFFER_DISCOUNT at 2, 3, 5 percent, skipping any pct > policy.maxDiscountPct, newExpectedDate = asOf+3
  // For reliable, slow, chronic only
  const discountPercentages = [2, 3, 5];
  for (const pct of discountPercentages) {
    if (pct <= policy.maxDiscountPct) {
      options.push({
        type: 'OFFER_DISCOUNT',
        invoiceId: invoice.id,
        discountPct: pct,
        newExpectedDate: addDays(asOf, 3),
      });
    }
  }

  // OFFER_INSTALMENTS for count 2..policy.maxInstalments, firstDate asOf+3, spacingDays 7
  // For slow and chronic only
  if (payer.persona === 'slow' || payer.persona === 'chronic') {
    for (let count = 2; count <= policy.maxInstalments; count++) {
      options.push({
        type: 'OFFER_INSTALMENTS',
        invoiceId: invoice.id,
        count,
        spacingDays: 7,
        firstDate: addDays(asOf, 3),
      });
    }
  }

  return options;
}

