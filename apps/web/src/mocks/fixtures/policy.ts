import type { Policy } from '@settle/shared';

export const mockPolicy: Policy = {
  maxDiscountPct: 5,
  maxInstalments: 3,
  autoApproveMaxAmount: 50000, // $500.00
  requireApprovalFor: ['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'],
  quietHours: {
    startHour: 20,
    endHour: 8,
  },
  maxRemindersPerInvoicePerWeek: 2,
};

