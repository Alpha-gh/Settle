import type { Invoice } from '@settle/shared';

export const mockInvoices: Invoice[] = [
  {
    id: 'inv_001',
    payerId: 'pay_002',
    number: 'INV-1001',
    description: 'Q3 Brand Campaign & Creative Direction',
    amount: 350000, // $3,500.00
    amountPaid: 0,
    issueDate: '2026-10-10',
    dueDate: '2026-10-24', // 9 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-R8M2-9K4L-5X7Q',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-R8M2-9K4L-5X7Q',
  },
  {
    id: 'inv_002',
    payerId: 'pay_003',
    number: 'INV-1002',
    description: 'Enterprise Design System Tokens',
    amount: 300000, // $3,000.00
    amountPaid: 0,
    issueDate: '2026-10-04',
    dueDate: '2026-10-18', // 15 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-B3V7-8T2P-4L9M',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-B3V7-8T2P-4L9M',
  },
  {
    id: 'inv_003',
    payerId: 'pay_001',
    number: 'INV-1003',
    description: 'E-commerce Checkout UX Redesign',
    amount: 250000, // $2,500.00
    amountPaid: 0,
    issueDate: '2026-10-14',
    dueDate: '2026-10-28', // 5 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-C4N8-2P9X-7K1L',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-C4N8-2P9X-7K1L',
  },
  {
    id: 'inv_004',
    payerId: 'pay_003',
    number: 'INV-1004',
    description: 'Supply Chain Portal Prototyping',
    amount: 180000, // $1,800.00
    amountPaid: 0,
    issueDate: '2026-10-06',
    dueDate: '2026-10-20', // 13 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-K9L1-6X3M-8V2P',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-K9L1-6X3M-8V2P',
  },
  {
    id: 'inv_005',
    payerId: 'pay_002',
    number: 'INV-1005',
    description: 'Media Asset Management Pipeline',
    amount: 160000, // $1,600.00
    amountPaid: 0,
    issueDate: '2026-10-12',
    dueDate: '2026-10-26', // 7 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-D5P2-4K7L-9X3V',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-D5P2-4K7L-9X3V',
  },
  {
    id: 'inv_006',
    payerId: 'pay_004',
    number: 'INV-1006',
    description: 'Annual Brand Refresh Retainer',
    amount: 220000, // $2,200.00
    amountPaid: 0,
    issueDate: '2026-09-16',
    dueDate: '2026-09-30', // 33 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-F6T8-3M1P-2K9L',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-F6T8-3M1P-2K9L',
  },
  {
    id: 'inv_007',
    payerId: 'pay_001',
    number: 'INV-1007',
    description: 'Mobile App Iconography Suite',
    amount: 140000, // $1,400.00
    amountPaid: 0,
    issueDate: '2026-10-15',
    dueDate: '2026-10-29', // 4 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-G7K3-9L4X-1V8P',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-G7K3-9L4X-1V8P',
  },
  {
    id: 'inv_008',
    payerId: 'pay_004',
    number: 'INV-1008',
    description: 'Corporate Stationery & Print Collateral',
    amount: 120000, // $1,200.00
    amountPaid: 0,
    issueDate: '2026-09-01',
    dueDate: '2026-09-15', // 48 days overdue
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    paypalInvoiceId: 'INV2-H8M4-1P7L-3X5V',
    payUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-H8M4-1P7L-3X5V',
  },
];

