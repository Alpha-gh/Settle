import type {
  Business,
  Invoice,
  Obligation,
  Payer,
  Policy,
  Snapshot,
} from '@settle/shared';

export function createPayer(override?: Partial<Payer>): Payer {
  return {
    id: 'pay_001',
    name: 'Default Payer',
    email: 'payer@example.com',
    persona: 'reliable',
    avgDaysLate: 0,
    latenessRisk: 0.05,
    ...override,
  };
}

export function createInvoice(override?: Partial<Invoice>): Invoice {
  return {
    id: 'inv_001',
    payerId: 'pay_001',
    number: 'INV-2026-001',
    description: 'Professional Services',
    amount: 100_000,
    amountPaid: 0,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    ...override,
  };
}

export function createObligation(override?: Partial<Obligation>): Obligation {
  return {
    id: 'obl_001',
    label: 'Standard Obligation',
    kind: 'other',
    amount: 100_000,
    dueDate: '2026-11-06',
    ...override,
  };
}

export const seedBusiness: Business = {
  id: 'biz_apex',
  name: 'Apex Digital Agency',
  currency: 'USD',
  asOf: '2026-11-02', // Monday
  startingBalance: 1_200_000, // $12,000
  reserveThreshold: 500_000,  // $5,000
};

export const seedPayers: Payer[] = [
  {
    id: 'pay_chronic',
    name: 'Nexus Ventures',
    email: 'billing@nexusventures.com',
    persona: 'chronic',
    avgDaysLate: 25,
    latenessRisk: 0.85,
  },
  {
    id: 'pay_reliable',
    name: 'Blue Ridge Media',
    email: 'accounts@blueridgemedia.com',
    persona: 'reliable',
    avgDaysLate: 15,
    latenessRisk: 0.1,
  },
  {
    id: 'pay_slow',
    name: 'Cascade Retail Group',
    email: 'ap@cascaderetail.com',
    persona: 'slow',
    avgDaysLate: 18,
    latenessRisk: 0.65,
  },
  {
    id: 'pay_ghost',
    name: 'Mirage Creative Lab',
    email: 'finance@miragecreative.io',
    persona: 'ghost',
    avgDaysLate: 90,
    latenessRisk: 0.98,
  },
  {
    id: 'pay_prompt',
    name: 'Vanguard Systems',
    email: 'payables@vanguardsystems.com',
    persona: 'reliable',
    avgDaysLate: 0,
    latenessRisk: 0.02,
  },
];

export const seedObligations: Obligation[] = [
  {
    id: 'obl_supplier',
    label: 'Cloud Infrastructure & SaaS',
    kind: 'supplier',
    amount: 200_000, // $2,000
    dueDate: '2026-11-04', // Wednesday
  },
  {
    id: 'obl_payroll',
    label: 'Bi-weekly Team Payroll',
    kind: 'payroll',
    amount: 1_100_000, // $11,000
    dueDate: '2026-11-06', // Friday
  },
  {
    id: 'obl_rent',
    label: 'Studio Office Lease',
    kind: 'rent',
    amount: 150_000, // $1,500
    dueDate: '2026-11-20',
  },
];

export const seedInvoices: Invoice[] = [
  // 1st largest overdue: $3,500 (Chronic)
  {
    id: 'inv_001',
    payerId: 'pay_chronic',
    number: 'INV-2026-081',
    description: 'Brand Identity & Strategy',
    amount: 350_000,
    amountPaid: 0,
    issueDate: '2026-09-15',
    dueDate: '2026-10-15',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // 2nd largest overdue: $3,200 (Reliable)
  {
    id: 'inv_002',
    payerId: 'pay_reliable',
    number: 'INV-2026-085',
    description: 'Web Application Frontend Sprint',
    amount: 320_000,
    amountPaid: 0,
    issueDate: '2026-09-26',
    dueDate: '2026-10-26',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // 3rd largest overdue: $3,000 (Slow)
  {
    id: 'inv_003',
    payerId: 'pay_slow',
    number: 'INV-2026-087',
    description: 'E-commerce UI/UX Overhaul',
    amount: 300_000,
    amountPaid: 0,
    issueDate: '2026-09-20',
    dueDate: '2026-10-20',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // Ghost payer overdue: $1,200
  {
    id: 'inv_004',
    payerId: 'pay_ghost',
    number: 'INV-2026-079',
    description: 'Video Motion Graphics',
    amount: 120_000,
    amountPaid: 0,
    issueDate: '2026-09-10',
    dueDate: '2026-10-10',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // Current small: $500
  {
    id: 'inv_005',
    payerId: 'pay_prompt',
    number: 'INV-2026-092',
    description: 'SEO Optimization Retainer',
    amount: 50_000,
    amountPaid: 0,
    issueDate: '2026-10-15',
    dueDate: '2026-11-15',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // Current small: $600
  {
    id: 'inv_006',
    payerId: 'pay_prompt',
    number: 'INV-2026-094',
    description: 'Content Marketing Package',
    amount: 60_000,
    amountPaid: 0,
    issueDate: '2026-10-18',
    dueDate: '2026-11-18',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  },
  // Partially paid small: $400 - $150 = $250 remaining
  {
    id: 'inv_007',
    payerId: 'pay_prompt',
    number: 'INV-2026-095',
    description: 'Social Media Assets',
    amount: 40_000,
    amountPaid: 15_000,
    issueDate: '2026-10-20',
    dueDate: '2026-11-20',
    status: 'PARTIALLY_PAID',
    discountPct: 0,
    allowPartial: true,
  },
  // Paid: $800 (not open)
  {
    id: 'inv_008',
    payerId: 'pay_prompt',
    number: 'INV-2026-088',
    description: 'Newsletter Template Design',
    amount: 80_000,
    amountPaid: 80_000,
    issueDate: '2026-09-25',
    dueDate: '2026-10-25',
    status: 'PAID',
    discountPct: 0,
    allowPartial: false,
  },
  // Draft: $1,500 (not open)
  {
    id: 'inv_009',
    payerId: 'pay_prompt',
    number: 'INV-2026-099',
    description: 'Mobile App Wireframing',
    amount: 150_000,
    amountPaid: 0,
    issueDate: '2026-11-01',
    dueDate: '2026-11-25',
    status: 'DRAFT',
    discountPct: 0,
    allowPartial: false,
  },
];

export const seedPolicy: Policy = {
  maxDiscountPct: 5,
  maxInstalments: 3,
  autoApproveMaxAmount: 100_000,
  requireApprovalFor: ['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'],
  quietHours: { startHour: 20, endHour: 8 },
  maxRemindersPerInvoicePerWeek: 2,
};

export function buildSeedSnapshot(): Snapshot {
  return {
    business: { ...seedBusiness },
    payers: seedPayers.map((p) => ({ ...p })),
    invoices: seedInvoices.map((i) => ({ ...i })),
    obligations: seedObligations.map((o) => ({ ...o })),
    policy: { ...seedPolicy, requireApprovalFor: [...seedPolicy.requireApprovalFor] },
  };
}

export const seedSnapshot: Snapshot = buildSeedSnapshot();

