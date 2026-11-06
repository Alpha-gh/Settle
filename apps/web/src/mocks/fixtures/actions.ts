import type { ActionRecord, AgentRunResult } from '@settle/shared';
import { mockScenarioComparison } from './forecast';

export const mockAgentActions: ActionRecord[] = [
  // 1. AWAITING_APPROVAL (closes gap with ScenarioComparison)
  {
    id: 'act_001',
    invoiceId: 'inv_001',
    type: 'OFFER_DISCOUNT',
    params: {
      discountPct: 5,
      note: 'Offer 5% discount for immediate payment by Friday Nov 6',
    },
    reason: 'Accelerates receipt to Nov 6, eliminating the $2,000 payroll reserve shortfall.',
    simulation: mockScenarioComparison,
    policy: {
      allowed: true,
      requiresApproval: true,
      violations: [],
    },
    status: 'AWAITING_APPROVAL',
    createdAt: '2026-11-02T09:30:00Z',
  },

  // 2. EXECUTED (auto-approved by policy)
  {
    id: 'act_002',
    invoiceId: 'inv_007',
    type: 'OFFER_DISCOUNT',
    params: {
      discountPct: 2,
      note: 'Early payment courtesy discount',
    },
    reason: 'Discount of $28.00 is well within $500 auto-approval threshold.',
    policy: {
      allowed: true,
      requiresApproval: false,
      violations: [],
    },
    status: 'EXECUTED',
    createdAt: '2026-11-02T09:31:00Z',
    decidedBy: 'auto',
    executedAt: '2026-11-02T09:31:05Z',
    paypalRequestId: 'PP-REQ-7F3A91',
  },

  // 3. PROPOSED
  {
    id: 'act_003',
    invoiceId: 'inv_002',
    type: 'REMIND',
    params: {
      note: 'Polite reminder for overdue tokens retainer',
    },
    reason: 'Invoice is 15 days overdue with chronic payer persona.',
    policy: {
      allowed: true,
      requiresApproval: false,
      violations: [],
    },
    status: 'PROPOSED',
    createdAt: '2026-11-02T09:32:00Z',
  },

  // 4. APPROVED
  {
    id: 'act_004',
    invoiceId: 'inv_003',
    type: 'OFFER_INSTALMENTS',
    params: {
      instalments: {
        count: 2,
        spacingDays: 14,
      },
      note: 'Split into two equal payments spaced by 14 days',
    },
    reason: 'Reliable payer experiencing temporary cashflow crunch.',
    policy: {
      allowed: true,
      requiresApproval: true,
      violations: [],
    },
    status: 'APPROVED',
    createdAt: '2026-11-02T09:33:00Z',
    decidedBy: 'owner',
  },

  // 5. REJECTED
  {
    id: 'act_005',
    invoiceId: 'inv_004',
    type: 'OFFER_DISCOUNT',
    params: {
      discountPct: 4,
    },
    reason: 'Owner rejected offering discount to chronic late payer.',
    policy: {
      allowed: true,
      requiresApproval: true,
      violations: [],
    },
    status: 'REJECTED',
    createdAt: '2026-11-02T09:34:00Z',
    decidedBy: 'owner',
  },

  // 6. BLOCKED (carries violations)
  {
    id: 'act_006',
    invoiceId: 'inv_005',
    type: 'OFFER_DISCOUNT',
    params: {
      discountPct: 8,
    },
    reason: 'Policy safety guardrail blocked action from execution.',
    policy: {
      allowed: false,
      requiresApproval: true,
      violations: ['Discount rate of 8% exceeds configured maximum allowed discount of 5%'],
    },
    status: 'BLOCKED',
    createdAt: '2026-11-02T09:35:00Z',
  },

  // 7. FAILED (carries error)
  {
    id: 'act_007',
    invoiceId: 'inv_006',
    type: 'ESCALATE',
    params: {
      note: 'Formal notice before escalation',
    },
    reason: 'Ghost payer uncontactable after 30 days overdue.',
    policy: {
      allowed: true,
      requiresApproval: true,
      violations: [],
    },
    status: 'FAILED',
    createdAt: '2026-11-02T09:36:00Z',
    error: 'PayPal API gateway timeout after 3 retries (PP-ERR-504)',
  },
];

export const mockAgentRunResult: AgentRunResult = {
  runId: 'run_20261102_001',
  actions: mockAgentActions,
  skipped: [
    {
      invoiceId: 'inv_008',
      why: 'Legal dispute pending on invoice INV-1008',
    },
  ],
};

