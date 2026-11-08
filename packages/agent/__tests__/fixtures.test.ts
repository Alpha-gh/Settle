import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../test-support/fixtures.js';

describe('fixtures', () => {
  it('snapshot has 8 overdue invoices and 1 ghost payer', () => {
    const snapshot = buildSnapshot();
    const asOf = snapshot.business.asOf;

    // Filter overdue invoices: due before asOf and unpaid
    const overdueInvoices = snapshot.invoices.filter(
      (inv) =>
        inv.dueDate < asOf &&
        inv.status !== 'PAID' &&
        inv.status !== 'CANCELLED' &&
        inv.status !== 'REFUNDED' &&
        inv.amountPaid < inv.amount,
    );

    expect(overdueInvoices).toHaveLength(8);

    const ghostPayers = snapshot.payers.filter(
      (p) => p.persona === 'ghost',
    );
    expect(ghostPayers).toHaveLength(1);
    expect(ghostPayers[0]?.id).toBe('pay_006');
  });

  it('contains correctly calibrated seed values', () => {
    const snapshot = buildSnapshot();
    expect(snapshot.business.name).toBe('Maya Studio');
    expect(snapshot.business.startingBalance).toBe(980000);
    expect(snapshot.business.reserveThreshold).toBe(500000);
    expect(snapshot.payers).toHaveLength(6);
    expect(snapshot.invoices).toHaveLength(14);
    expect(snapshot.obligations).toHaveLength(3);
  });
});

