import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Business,
  Payer,
  Invoice,
  Obligation,
  Policy,
  Snapshot,
  ISODate,
  Cents,
} from '@settle/shared';

// ── helpers ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function isoDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function id(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(3, '0')}`;
}

// ── main ─────────────────────────────────────────────────────────────────
function generate(): Snapshot {
  const today = new Date(process.env.DEMO_TODAY ?? '2026-11-05');
  today.setUTCHours(0, 0, 0, 0);

  // Business
  const business: Business = {
    id: 'biz_001',
    name: 'Maya Studio',
    currency: 'USD',
    asOf: isoDate(today),
    startingBalance: 980_000,     // $9,800
    reserveThreshold: 500_000,    // $5,000
  };

  // Payers: 2 reliable, 1 slow, 2 chronic, 1 ghost
  const payers: Payer[] = [
    { id: 'pay_001', name: 'Acme Corp',        email: 'acme-sb@sandbox.settle.dev',        persona: 'reliable', avgDaysLate: 1,  latenessRisk: 0.05 },
    { id: 'pay_002', name: 'Bright LLC',       email: 'bright-sb@sandbox.settle.dev',      persona: 'reliable', avgDaysLate: 0,  latenessRisk: 0.03 },
    { id: 'pay_003', name: 'Crimson Inc',      email: 'crimson-sb@sandbox.settle.dev',      persona: 'slow',     avgDaysLate: 12, latenessRisk: 0.55 },
    { id: 'pay_004', name: 'Delta Services',   email: 'delta-sb@sandbox.settle.dev',       persona: 'chronic',  avgDaysLate: 25, latenessRisk: 0.80 },
    { id: 'pay_005', name: 'Echo Dynamics',    email: 'echo-sb@sandbox.settle.dev',        persona: 'chronic',  avgDaysLate: 30, latenessRisk: 0.85 },
    { id: 'pay_006', name: 'Phantom Ltd',      email: 'phantom-sb@sandbox.settle.dev',     persona: 'ghost',    avgDaysLate: 90, latenessRisk: 0.95 },
  ];

  // Obligations
  const obligations: Obligation[] = [
    { id: 'obl_001', label: 'Payroll Nov',      kind: 'payroll',  amount: 680_000, dueDate: isoDate(addDays(today, 4)) },
    { id: 'obl_002', label: 'Supplier – Ink Co', kind: 'supplier', amount: 140_000, dueDate: isoDate(addDays(today, 7)) },
    { id: 'obl_003', label: 'Office Rent Dec',   kind: 'rent',     amount: 220_000, dueDate: isoDate(addDays(today, 10)) },
  ];

  // Invoices:
  // We need ~14 invoices, 8 overdue totalling ~1,400,000–1,500,000 cents.
  // The three largest overdue must belong to slow/chronic payers.
  // Also need some non-overdue for reliable payers.
  const invoices: Invoice[] = [
    // ── Overdue invoices (8) ──
    // Three largest overdue → slow (Crimson) and chronic (Delta, Echo)
    inv('inv_001', 'pay_003', 'INV-1001', 'Web design – Phase 2',    350_000, 0,       -15, -5, today),   // Crimson, overdue
    inv('inv_002', 'pay_004', 'INV-1002', 'Brand strategy retainer',  320_000, 0,       -25, -10, today),  // Delta, overdue
    inv('inv_003', 'pay_005', 'INV-1003', 'UX audit Q3',             280_000, 0,       -30, -8, today),   // Echo, overdue
    // Remaining 5 overdue (smaller, mixed payers)
    inv('inv_004', 'pay_004', 'INV-1004', 'Logo refresh',             150_000, 0,       -20, -3, today),  // Delta, overdue
    inv('inv_005', 'pay_005', 'INV-1005', 'Illustration pack',        120_000, 0,       -18, -4, today),  // Echo, overdue
    inv('inv_006', 'pay_006', 'INV-1006', 'Stationery design',        80_000,  0,       -40, -12, today), // Phantom, overdue
    inv('inv_007', 'pay_003', 'INV-1007', 'Social media templates',   60_000,  0,       -10, -2, today),  // Crimson, overdue
    inv('inv_008', 'pay_006', 'INV-1008', 'Packaging mockup',         50_000,  0,       -35, -7, today),  // Phantom, overdue
    // Total overdue = 350+320+280+150+120+80+60+50 = 1,410,000 ✓

    // ── Non-overdue invoices (6) ──
    inv('inv_009', 'pay_001', 'INV-1009', 'Annual report design',    180_000, 180_000, -30, -5, today, 'PAID'),
    inv('inv_010', 'pay_001', 'INV-1010', 'Brand guidelines portal', 150_000, 0,       -5,   6, today),  // Acme, due day 6
    inv('inv_011', 'pay_002', 'INV-1011', 'Product catalog',         120_000, 120_000, -20, -2, today, 'PAID'),
    inv('inv_012', 'pay_002', 'INV-1012', 'Design system rollout',   230_000, 0,       -6,   9, today),  // Bright, due day 9
    inv('inv_013', 'pay_001', 'INV-1013', 'Poster series',            60_000, 0,       -3,  12, today),  // Acme, due day 12
    inv('inv_014', 'pay_003', 'INV-1014', 'App icon set',             45_000, 0,       -1,  14, today),  // Crimson, future
  ];

  // Default policy (Contract v1)
  const policy: Policy = {
    maxDiscountPct: 10,
    maxInstalments: 4,
    autoApproveMaxAmount: 200_000,
    requireApprovalFor: ['OFFER_DISCOUNT', 'ESCALATE'],
    quietHours: { startHour: 22, endHour: 7 },
    maxRemindersPerInvoicePerWeek: 3,
  };

  return { business, payers, invoices, obligations, policy };
}

function inv(
  invId: string,
  payerId: string,
  num: string,
  desc: string,
  amount: Cents,
  amountPaid: Cents,
  issueDaysAgo: number,
  dueDaysFromToday: number,
  today: Date,
  forceStatus?: 'PAID',
): Invoice {
  const issueDate = isoDate(addDays(today, issueDaysAgo));
  const dueDate = isoDate(addDays(today, dueDaysFromToday));
  let status: Invoice['status'];
  if (forceStatus === 'PAID') {
    status = 'PAID';
  } else if (amountPaid > 0 && amountPaid < amount) {
    status = 'PARTIALLY_PAID';
  } else if (amountPaid >= amount) {
    status = 'PAID';
  } else {
    status = 'SENT';
  }
  return {
    id: invId,
    payerId,
    number: num,
    description: desc,
    amount,
    amountPaid,
    issueDate,
    dueDate,
    status,
    discountPct: 0,
    allowPartial: false,
  };
}

// ── Self-check / calibration ─────────────────────────────────────────────
interface CalibrationResult {
  baselineLowest: Cents;
  baselineLowestDate: ISODate;
  shortfall: Cents;
  firstBreachDate: ISODate | null;
  topThreeOverdue: { id: string; amount: Cents; payerId: string }[];
  gapClosedByAnyTwo: boolean;
}

function selfCheck(snapshot: Snapshot): CalibrationResult {
  const { business, invoices, obligations } = snapshot;
  const today = new Date(business.asOf);
  today.setUTCHours(0, 0, 0, 0);

  // Simple day-by-day forecast (baseline: no overdue receipts expected)
  const horizonDays = 15;
  let balance = business.startingBalance;
  let lowest = balance;
  let lowestDate = business.asOf;
  let firstBreachDate: ISODate | null = null;

  // Collect reliable payer receipts (non-overdue, unpaid invoices from reliable payers)
  const reliableDue = new Map<string, Cents>(); // date → amount
  for (const inv of invoices) {
    if (inv.status === 'PAID') continue;
    // In baseline, only count reliable payers' non-overdue invoices
    const isOverdue = inv.dueDate < business.asOf;
    if (isOverdue) continue;
    // For baseline, assume non-overdue invoices get paid on due date
    const payerObj = snapshot.payers.find(p => p.id === inv.payerId);
    if (payerObj && (payerObj.persona === 'reliable')) {
      const remaining = inv.amount - inv.amountPaid;
      reliableDue.set(inv.dueDate, (reliableDue.get(inv.dueDate) ?? 0) + remaining);
    }
  }

  // Collect obligation outflows
  const oblDue = new Map<string, Cents>();
  for (const obl of obligations) {
    oblDue.set(obl.dueDate, (oblDue.get(obl.dueDate) ?? 0) + obl.amount);
  }

  for (let d = 0; d < horizonDays; d++) {
    const date = isoDate(addDays(today, d));
    const inflow = reliableDue.get(date) ?? 0;
    const outflow = oblDue.get(date) ?? 0;
    balance = balance + inflow - outflow;

    if (balance < lowest) {
      lowest = balance;
      lowestDate = date;
    }
    if (balance < business.reserveThreshold && firstBreachDate === null) {
      firstBreachDate = date;
    }
  }

  const shortfall = Math.max(0, business.reserveThreshold - lowest);

  // Identify top 3 overdue invoices by amount
  const overdueInvoices = invoices
    .filter(inv => inv.dueDate < business.asOf && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && inv.status !== 'REFUNDED')
    .sort((a, b) => (b.amount - b.amountPaid) - (a.amount - a.amountPaid));

  const topThree = overdueInvoices.slice(0, 3).map(inv => ({
    id: inv.id,
    amount: inv.amount - inv.amountPaid,
    payerId: inv.payerId,
  }));

  // Check: collecting any 2 of top 3 before payroll closes the gap
  // "closes the gap" = balance never drops below reserve
  let gapClosedByAnyTwo = true;
  const combos: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  for (const [i, j] of combos) {
    // Simulate: add these two amounts on day before payroll (today+3)
    const extraCash = topThree[i].amount + topThree[j].amount;
    let simBal = business.startingBalance + extraCash;
    let simBreaches = false;

    for (let d = 0; d < horizonDays; d++) {
      const date = isoDate(addDays(today, d));
      const inflow = reliableDue.get(date) ?? 0;
      const outflow = oblDue.get(date) ?? 0;
      simBal = simBal + inflow - outflow;
      if (simBal < business.reserveThreshold) {
        simBreaches = true;
      }
    }
    if (simBreaches) {
      gapClosedByAnyTwo = false;
    }
  }

  return { baselineLowest: lowest, baselineLowestDate: lowestDate, shortfall, firstBreachDate, topThreeOverdue: topThree, gapClosedByAnyTwo };
}

// ── Run ──────────────────────────────────────────────────────────────────
const snapshot = generate();
const check = selfCheck(snapshot);

console.log('=== Settle Seed Calibration ===');
console.log(`Demo date:           ${snapshot.business.asOf}`);
console.log(`Starting balance:    ${snapshot.business.startingBalance} cents ($${(snapshot.business.startingBalance / 100).toFixed(2)})`);
console.log(`Reserve threshold:   ${snapshot.business.reserveThreshold} cents ($${(snapshot.business.reserveThreshold / 100).toFixed(2)})`);
console.log('');
console.log(`Baseline lowest:     ${check.baselineLowest} cents ($${(check.baselineLowest / 100).toFixed(2)}) on ${check.baselineLowestDate}`);
console.log(`Shortfall:           ${check.shortfall} cents ($${(check.shortfall / 100).toFixed(2)})`);
console.log(`First breach date:   ${check.firstBreachDate ?? 'none'}`);
console.log('');
console.log('Top 3 overdue invoices:');
for (const t of check.topThreeOverdue) {
  const payer = snapshot.payers.find(p => p.id === t.payerId);
  console.log(`  ${t.id}: ${t.amount} cents ($${(t.amount / 100).toFixed(2)}) – ${payer?.name} (${payer?.persona})`);
}
console.log('');
console.log(`Collecting any 2 of top 3 closes gap: ${check.gapClosedByAnyTwo}`);

// Assertions
const obligationDates = snapshot.obligations.map(o => o.dueDate).sort();
const payrollDate = snapshot.obligations.find(o => o.kind === 'payroll')!.dueDate;
if (check.firstBreachDate !== payrollDate) {
  console.error(`FAIL: Expected first breach at payroll (${payrollDate}), got ${check.firstBreachDate}`);
  process.exit(1);
}
if (check.shortfall < 150_000 || check.shortfall > 250_000) {
  console.error(`FAIL: Shortfall ${check.shortfall} not in range 150,000–250,000`);
  process.exit(1);
}
if (!check.gapClosedByAnyTwo) {
  console.error('FAIL: Collecting any 2 of top 3 overdue does NOT close the gap');
  process.exit(1);
}

// Count overdue
const overdueCount = snapshot.invoices.filter(
  i => i.dueDate < snapshot.business.asOf && i.status !== 'PAID' && i.status !== 'CANCELLED' && i.status !== 'REFUNDED',
).length;
const overdueTotal = snapshot.invoices
  .filter(i => i.dueDate < snapshot.business.asOf && i.status !== 'PAID' && i.status !== 'CANCELLED' && i.status !== 'REFUNDED')
  .reduce((sum, i) => sum + (i.amount - i.amountPaid), 0);
console.log(`\nOverdue invoices:    ${overdueCount} totalling ${overdueTotal} cents ($${(overdueTotal / 100).toFixed(2)})`);

if (overdueCount !== 8) {
  console.error(`FAIL: Expected 8 overdue invoices, got ${overdueCount}`);
  process.exit(1);
}
if (overdueTotal < 1_400_000 || overdueTotal > 1_500_000) {
  console.error(`FAIL: Overdue total ${overdueTotal} not in range 1,400,000–1,500,000`);
  process.exit(1);
}

// Top 3 must be slow/chronic payers
for (const t of check.topThreeOverdue) {
  const payer = snapshot.payers.find(p => p.id === t.payerId);
  if (payer && payer.persona !== 'slow' && payer.persona !== 'chronic') {
    console.error(`FAIL: Top overdue ${t.id} belongs to ${payer.persona} payer, expected slow or chronic`);
    process.exit(1);
  }
}

console.log('\n✅ All calibration checks passed!');

// Write seed
const seedDir = resolve(REPO_ROOT, 'seed');
mkdirSync(seedDir, { recursive: true });
writeFileSync(resolve(seedDir, 'demo.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
console.log(`\nWrote seed/demo.json`);
