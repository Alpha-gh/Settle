import type { Invoice, Id } from '@settle/shared';

// Deterministic pseudo-random number generator (Mulberry32)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDeterministicInvoices(count = 200): Invoice[] {
  const rand = mulberry32(42);
  const payerIds: Id[] = ['pay_001', 'pay_002', 'pay_003', 'pay_004'];
  const invoices: Invoice[] = [];

  for (let i = 1; i <= count; i++) {
    const padIndex = i.toString().padStart(4, '0');
    const payerIndex = Math.floor(rand() * payerIds.length);
    const payerId = payerIds[payerIndex] ?? 'pay_001';

    // Amounts in cents between $200.00 and $10,000.00
    const amount = 20000 + Math.floor(rand() * 980000);

    // Days late between 1 and 60 days
    const daysOffset = Math.floor(rand() * 60) + 1;
    const dueDay = Math.max(1, 31 - (daysOffset % 28))
      .toString()
      .padStart(2, '0');
    const dueMonth = (daysOffset > 28 ? '09' : '10');
    const dueDate = `2026-${dueMonth}-${dueDay}`;
    const issueDate = `2026-08-15`;

    invoices.push({
      id: `inv_perf_${padIndex}`,
      payerId,
      number: `INV-PERF-${padIndex}`,
      description: `Performance benchmark invoice item #${i}`,
      amount,
      amountPaid: 0,
      issueDate,
      dueDate,
      status: 'SENT',
      discountPct: 0,
      allowPartial: false,
      paypalInvoiceId: `INV2-PERF-${padIndex}`,
      payUrl: `https://www.sandbox.paypal.com/invoice/p/#INV2-PERF-${padIndex}`,
    });
  }

  return invoices;
}

