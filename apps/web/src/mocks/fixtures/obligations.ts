import type { Obligation } from '@settle/shared';

export const mockObligations: Obligation[] = [
  {
    id: 'obl_001',
    label: 'Payroll November (Bi-weekly)',
    kind: 'payroll',
    amount: 1200000, // $12,000.00
    dueDate: '2026-11-06', // Friday breach point
  },
  {
    id: 'obl_002',
    label: 'AWS & Figma Cloud Infrastructure',
    kind: 'supplier',
    amount: 150000, // $1,500.00
    dueDate: '2026-11-16',
  },
  {
    id: 'obl_003',
    label: 'Design Studio Rent',
    kind: 'rent',
    amount: 200000, // $2,000.00
    dueDate: '2026-11-20',
  },
];

