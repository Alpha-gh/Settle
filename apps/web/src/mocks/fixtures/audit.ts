import type { AuditEvent } from '@settle/shared';

export const baselineAuditEvents: AuditEvent[] = [
  {
    id: 'aud_001',
    ts: '2026-11-02T08:00:00Z',
    actor: 'system',
    kind: 'system.asOf',
    summary: 'Simulation anchor set to 2026-11-02 (Monday) with reserve threshold of $5,000.00',
  },
  {
    id: 'aud_002',
    ts: '2026-11-02T08:05:00Z',
    actor: 'paypal',
    kind: 'invoice.synced',
    summary: 'Synchronized 8 overdue invoices ($17,200.00 total) from PayPal Sandbox',
  },
  {
    id: 'aud_003',
    ts: '2026-11-02T08:10:00Z',
    actor: 'system',
    kind: 'forecast.computed',
    summary: 'Cashflow forecast identified $2,000.00 reserve shortfall on Friday Nov 6 (Payroll)',
  },
];

