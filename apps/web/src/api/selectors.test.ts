import { describe, it, expect } from 'vitest';
import { selectWorklistRows, selectWorklistRowByActionId, selectWorklistRowByInvoiceId } from './selectors';
import type { Snapshot, ActionRecord } from '@settle/shared';

describe('selectWorklistRows', () => {
  const mockSnapshot: Snapshot = {
    business: {
      id: 'biz_1',
      name: 'Northwind',
      currency: 'USD',
      asOf: '2026-11-02',
      startingBalance: 100000,
      reserveThreshold: 50000,
    },
    payers: [
      {
        id: 'pay_1',
        name: 'Acme Corp',
        email: 'acme@test.com',
        persona: 'reliable',
        avgDaysLate: 2,
        latenessRisk: 0.1,
      },
    ],
    invoices: [
      {
        id: 'inv_1',
        payerId: 'pay_1',
        number: 'INV-1001',
        description: 'Test inv 1',
        amount: 50000,
        amountPaid: 0,
        issueDate: '2026-10-10',
        dueDate: '2026-10-25',
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
      {
        id: 'inv_2',
        payerId: 'pay_unknown',
        number: 'INV-1002',
        description: 'Test inv 2',
        amount: 80000,
        amountPaid: 0,
        issueDate: '2026-10-01',
        dueDate: '2026-11-10', // future
        status: 'SENT',
        discountPct: 0,
        allowPartial: false,
      },
    ],
    obligations: [],
    policy: {
      maxDiscountPct: 5,
      maxInstalments: 3,
      autoApproveMaxAmount: 50000,
      requireApprovalFor: ['OFFER_DISCOUNT'],
      quietHours: { startHour: 20, endHour: 8 },
      maxRemindersPerInvoicePerWeek: 2,
    },
  };

  const mockActions: ActionRecord[] = [
    {
      id: 'act_1',
      invoiceId: 'inv_1',
      type: 'OFFER_DISCOUNT',
      params: { discountPct: 3 },
      reason: 'Accelerates payment',
      policy: { allowed: true, requiresApproval: true, violations: [] },
      status: 'AWAITING_APPROVAL',
      createdAt: '2026-11-02T10:00:00Z',
    },
  ];

  it('joins invoices, payers, and actions correctly', () => {
    const rows = selectWorklistRows(mockSnapshot, mockActions);
    expect(rows).toHaveLength(2);

    const row1 = rows[0]!;
    expect(row1.id).toBe('inv_1');
    expect(row1.invoice.number).toBe('INV-1001');
    expect(row1.payer?.name).toBe('Acme Corp');
    expect(row1.action?.id).toBe('act_1');
    expect(row1.daysOverdue).toBe(8); // 2026-10-25 to 2026-11-02 = 8 days

    const row2 = rows[1]!;
    expect(row2.id).toBe('inv_2');
    expect(row2.payer).toBeUndefined();
    expect(row2.action).toBeUndefined();
    expect(row2.daysOverdue).toBe(0); // future due date clamped at 0
  });

  it('finds row by actionId or invoiceId', () => {
    const rows = selectWorklistRows(mockSnapshot, mockActions);
    expect(selectWorklistRowByActionId(rows, 'act_1')?.id).toBe('inv_1');
    expect(selectWorklistRowByActionId(rows, 'act_none')).toBeUndefined();
    expect(selectWorklistRowByInvoiceId(rows, 'inv_2')?.invoice.number).toBe('INV-1002');
  });

  it('returns empty array when snapshot is missing or empty', () => {
    expect(selectWorklistRows(null, mockActions)).toEqual([]);
    expect(selectWorklistRows(undefined, mockActions)).toEqual([]);
  });
});

