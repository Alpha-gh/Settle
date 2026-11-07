import { describe, expect, it } from 'vitest';
import type { Invoice, Payer } from '@settle/shared';
import { expectedReceipts } from '../src/expectedReceipts.js';
import { EngineError } from '../src/errors.js';
import { assertNoNaN, deepFreeze } from './helpers.js';

describe('expectedReceipts', () => {
  const asOf = '2026-03-01';

  const payers: Payer[] = [
    {
      id: 'p_reliable',
      name: 'Reliable Co',
      email: 'rel@example.com',
      persona: 'reliable',
      avgDaysLate: 2,
      latenessRisk: 0.1,
    },
    {
      id: 'p_slow_14',
      name: 'Slow 14 Co',
      email: 'slow14@example.com',
      persona: 'slow',
      avgDaysLate: 14,
      latenessRisk: 0.4,
    },
    {
      id: 'p_slow_15',
      name: 'Slow 15 Co',
      email: 'slow15@example.com',
      persona: 'slow',
      avgDaysLate: 15,
      latenessRisk: 0.5,
    },
    {
      id: 'p_chronic',
      name: 'Chronic Co',
      email: 'chronic@example.com',
      persona: 'chronic',
      avgDaysLate: 25,
      latenessRisk: 0.8,
    },
    {
      id: 'p_ghost',
      name: 'Ghost Co',
      email: 'ghost@example.com',
      persona: 'ghost',
      avgDaysLate: 60,
      latenessRisk: 1.0,
    },
  ];

  it('handles persona rules correctly: reliable, slow (<=14 vs >14), chronic, and ghost', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_rel',
        payerId: 'p_reliable',
        number: 'INV-001',
        description: 'Design work',
        amount: 100_000,
        amountPaid: 0,
        issueDate: '2026-02-15',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_slow14',
        payerId: 'p_slow_14',
        number: 'INV-002',
        description: 'Dev work',
        amount: 200_000,
        amountPaid: 0,
        issueDate: '2026-02-15',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_slow15',
        payerId: 'p_slow_15',
        number: 'INV-003',
        description: 'Hosting',
        amount: 300_000,
        amountPaid: 0,
        issueDate: '2026-02-15',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_chronic',
        payerId: 'p_chronic',
        number: 'INV-004',
        description: 'Consulting',
        amount: 400_000,
        amountPaid: 0,
        issueDate: '2026-02-15',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_ghost',
        payerId: 'p_ghost',
        number: 'INV-005',
        description: 'Audit',
        amount: 500_000,
        amountPaid: 0,
        issueDate: '2026-02-15',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
    ];

    const receipts = expectedReceipts(invoices, payers, asOf);
    assertNoNaN(receipts);

    const rel = receipts.find((r) => r.invoiceId === 'inv_rel');
    expect(rel).toEqual({
      invoiceId: 'inv_rel',
      amount: 100_000,
      date: '2026-03-07', // 2026-03-05 + 2
      confidence: 'expected',
    });

    const slow14 = receipts.find((r) => r.invoiceId === 'inv_slow14');
    expect(slow14).toEqual({
      invoiceId: 'inv_slow14',
      amount: 200_000,
      date: '2026-03-19', // 2026-03-05 + 14
      confidence: 'expected',
    });

    const slow15 = receipts.find((r) => r.invoiceId === 'inv_slow15');
    expect(slow15).toEqual({
      invoiceId: 'inv_slow15',
      amount: 300_000,
      date: '2026-03-20', // 2026-03-05 + 15
      confidence: 'uncertain',
    });

    const chronic = receipts.find((r) => r.invoiceId === 'inv_chronic');
    expect(chronic).toEqual({
      invoiceId: 'inv_chronic',
      amount: 400_000,
      date: '2026-03-30', // 2026-03-05 + 25
      confidence: 'uncertain',
    });

    const ghost = receipts.find((r) => r.invoiceId === 'inv_ghost');
    expect(ghost).toEqual({
      invoiceId: 'inv_ghost',
      amount: 500_000,
      date: '2026-05-30', // asOf (2026-03-01) + 90 days
      confidence: 'uncertain',
    });
  });

  it('subtracts amountPaid for PARTIALLY_PAID and skips when remaining <= 0', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_part',
        payerId: 'p_reliable',
        number: 'INV-101',
        description: 'Partial item',
        amount: 100_000,
        amountPaid: 40_000,
        issueDate: '2026-02-01',
        dueDate: '2026-03-10',
        status: 'PARTIALLY_PAID',
        discountPct: 0,
        allowPartial: true,
      },
      {
        id: 'inv_paid_via_part',
        payerId: 'p_reliable',
        number: 'INV-102',
        description: 'Fully paid via partial',
        amount: 50_000,
        amountPaid: 50_000,
        issueDate: '2026-02-01',
        dueDate: '2026-03-10',
        status: 'PARTIALLY_PAID',
        discountPct: 0,
        allowPartial: true,
      },
    ];

    const receipts = expectedReceipts(invoices, payers, asOf);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({
      invoiceId: 'inv_part',
      amount: 60_000,
      date: '2026-03-12',
      confidence: 'expected',
    });
  });

  it('applies discountPct with integer half-up math before subtracting amountPaid', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_disc',
        payerId: 'p_reliable',
        number: 'INV-103',
        description: 'Discounted invoice',
        amount: 100_000, // $1,000.00
        amountPaid: 20_000, // $200.00
        issueDate: '2026-02-01',
        dueDate: '2026-03-10',
        status: 'SENT',
        discountPct: 5, // 5% off 100_000 = 95_000, minus 20_000 = 75_000
        allowPartial: false,
      },
    ];

    const receipts = expectedReceipts(invoices, payers, asOf);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.amount).toBe(75_000);
  });

  it('ignores non-open statuses (DRAFT, PAID, CANCELLED, REFUNDED)', () => {
    const nonOpenStatuses: Invoice['status'][] = ['DRAFT', 'PAID', 'CANCELLED', 'REFUNDED'];
    const invoices: Invoice[] = nonOpenStatuses.map((status, idx) => ({
      id: `inv_non_${idx}`,
      payerId: 'p_reliable',
      number: `INV-NON-${idx}`,
      description: 'Non-open',
      amount: 100_000,
      amountPaid: 0,
      issueDate: '2026-02-01',
      dueDate: '2026-03-10',
      status,
      discountPct: 0,
      allowPartial: false,
    }));

    const receipts = expectedReceipts(invoices, payers, asOf);
    expect(receipts).toHaveLength(0);
  });

  it('clamps projected date to asOf when already overdue', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_overdue',
        payerId: 'p_reliable', // avgDaysLate = 2
        number: 'INV-OVER',
        description: 'Overdue invoice',
        amount: 100_000,
        amountPaid: 0,
        issueDate: '2026-01-01',
        dueDate: '2026-01-15', // 2026-01-15 + 2 = 2026-01-17, which is < asOf (2026-03-01)
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
    ];

    const receipts = expectedReceipts(invoices, payers, asOf);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.date).toBe(asOf); // Clamped to asOf
  });

  it('sorts output deterministically by (date ASC, invoiceId ASC)', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_B',
        payerId: 'p_reliable', // +2 days -> 2026-03-07
        number: 'B',
        description: 'B',
        amount: 10_000,
        amountPaid: 0,
        issueDate: '2026-02-01',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_A',
        payerId: 'p_reliable', // +2 days -> 2026-03-07
        number: 'A',
        description: 'A',
        amount: 10_000,
        amountPaid: 0,
        issueDate: '2026-02-01',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_C',
        payerId: 'p_reliable', // +2 days -> 2026-03-03
        number: 'C',
        description: 'C',
        amount: 10_000,
        amountPaid: 0,
        issueDate: '2026-02-01',
        dueDate: '2026-03-01',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
    ];

    const receipts = expectedReceipts(invoices, payers, asOf);
    expect(receipts.map((r) => r.invoiceId)).toEqual(['inv_C', 'inv_A', 'inv_B']);
  });

  it('throws EngineError INVALID_INPUT for non-array inputs, null items, or unknown persona', () => {
    expect(() => expectedReceipts('not-array' as any, payers, asOf)).toThrowError(EngineError);
    expect(() => expectedReceipts([], 'not-array' as any, asOf)).toThrowError(EngineError);
    expect(() => expectedReceipts([null as any], payers, asOf)).toThrowError(EngineError);
    expect(() => expectedReceipts([], [null as any], asOf)).toThrowError(EngineError);

    const badPersonaPayer: Payer = {
      id: 'p_alien',
      name: 'Alien',
      email: 'alien@example.com',
      persona: 'alien' as any,
      avgDaysLate: 0,
      latenessRisk: 0,
    };
    const inv: Invoice = {
      id: 'inv_alien',
      payerId: 'p_alien',
      number: 'INV-A',
      description: 'A',
      amount: 100_000,
      amountPaid: 0,
      issueDate: '2026-02-01',
      dueDate: '2026-03-05',
      status: 'SENT',
      discountPct: 0,
      allowPartial: false,
    };
    expect(() => expectedReceipts([inv], [badPersonaPayer], asOf)).toThrowError(EngineError);
  });

  it('throws EngineError NOT_FOUND naming invoice id when payer is missing', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv_missing_payer',
        payerId: 'p_unknown',
        number: 'INV-404',
        description: 'Unknown payer',
        amount: 100_000,
        amountPaid: 0,
        issueDate: '2026-02-01',
        dueDate: '2026-03-10',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
    ];

    expect(() => expectedReceipts(invoices, payers, asOf)).toThrowError(EngineError);
    try {
      expectedReceipts(invoices, payers, asOf);
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      const e = err as EngineError;
      expect(e.code).toBe('NOT_FOUND');
      expect(e.message).toContain('inv_missing_payer');
    }
  });

  it('is deterministic and does not mutate inputs', () => {
    const invoices: Invoice[] = deepFreeze([
      {
        id: 'inv_1',
        payerId: 'p_reliable',
        number: 'INV-1',
        description: 'Test',
        amount: 100_000,
        amountPaid: 10_000,
        issueDate: '2026-02-01',
        dueDate: '2026-03-05',
        status: 'SENT',
        discountPct: 2,
        allowPartial: false,
      },
    ]);
    const frozenPayers: Payer[] = deepFreeze([...payers]);

    const run1 = expectedReceipts(invoices, frozenPayers, asOf);
    const run2 = expectedReceipts(invoices, frozenPayers, asOf);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
