import type { Payer } from '@settle/shared';

export const mockPayers: Payer[] = [
  {
    id: 'pay_001',
    name: 'Acme Retail',
    email: 'acme-billing@sandbox.settle.dev',
    persona: 'reliable',
    avgDaysLate: 1,
    latenessRisk: 0.05,
  },
  {
    id: 'pay_002',
    name: 'Bluefin Media',
    email: 'accounts@bluefinmedia.sandbox.settle.dev',
    persona: 'slow',
    avgDaysLate: 14,
    latenessRisk: 0.35,
  },
  {
    id: 'pay_003',
    name: 'Crestview Logistics',
    email: 'ap@crestview.sandbox.settle.dev',
    persona: 'chronic',
    avgDaysLate: 28,
    latenessRisk: 0.75,
  },
  {
    id: 'pay_004',
    name: 'Dark Horse Holdings',
    email: 'finance@darkhorse.sandbox.settle.dev',
    persona: 'ghost',
    avgDaysLate: 75,
    latenessRisk: 0.95,
  },
];

