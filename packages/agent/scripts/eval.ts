import process from 'node:process';
import type {
  EnginePort,
  Invoice,
  ISODate,
  Payer,
  PayerPersona,
  Policy,
  Snapshot,
} from '@settle/shared';
import { createAgent } from '../src/agent.js';
import { addDays, FixedClock } from '../src/clock.js';
import { DeterministicIdGen } from '../src/ids.js';
import { createLlmFromEnv } from '../src/llm/factory.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';

// Safe .env loading without printing keys
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // ignore if .env missing
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(): { provider: string; engine: string } {
  const args = process.argv.slice(2);
  let provider = process.env.LLM_PROVIDER || 'mock';
  let engine = 'fake';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider' && args[i + 1]) {
      provider = args[++i]!;
    } else if (arg?.startsWith('--provider=')) {
      provider = arg.split('=')[1]!;
    } else if (arg === '--engine' && args[i + 1]) {
      engine = args[++i]!;
    } else if (arg?.startsWith('--engine=')) {
      engine = arg.split('=')[1]!;
    }
  }

  return { provider: provider.toLowerCase(), engine: engine.toLowerCase() };
}

function generateDeterministicSnapshots(count = 20): Snapshot[] {
  const personas: PayerPersona[] = ['reliable', 'slow', 'chronic', 'ghost'];
  const rng = mulberry32(20261108);

  const snapshots: Snapshot[] = [];

  for (let s = 1; s <= count; s++) {
    const asOf: ISODate = '2026-11-05';
    const startingBalance = Math.round(1000 + rng() * 4000) * 100;
    const reserveThreshold = Math.round(2000 + rng() * 3000) * 100;

    const numPayers = 3;
    const payers: Payer[] = [];
    for (let p = 1; p <= numPayers; p++) {
      const persona = personas[(s + p) % personas.length]!;
      payers.push({
        id: `pay_${s}_${p}`,
        name: `Customer ${s}-${p}`,
        email: `c${s}_${p}@example.com`,
        persona,
        avgDaysLate: Math.round(5 + rng() * 20),
        latenessRisk: parseFloat((0.1 + rng() * 0.7).toFixed(2)),
      });
    }

    const numInvoices = 2 + Math.floor(rng() * 3); // 2..4 invoices
    const invoices: Invoice[] = [];
    for (let i = 1; i <= numInvoices; i++) {
      const payer = payers[i % payers.length]!;
      const amount = Math.round(500 + rng() * 4000) * 100; // $500..$4500
      const daysOverdue = 2 + Math.floor(rng() * 15);
      const dueDate = addDays(asOf, -daysOverdue);
      const isPartiallyPaid = rng() > 0.7;
      const amountPaid = isPartiallyPaid ? Math.round(amount * 0.3) : 0;

      invoices.push({
        id: `inv_${s}_${i}`,
        payerId: payer.id,
        number: `INV-${s}${i.toString().padStart(2, '0')}`,
        description: `Project work ${s}-${i}`,
        amount,
        amountPaid,
        issueDate: addDays(dueDate, -30),
        dueDate,
        status: isPartiallyPaid ? 'PARTIALLY_PAID' : 'SENT',
        discountPct: 0,
        allowPartial: true,
      });
    }

    const policy: Policy = {
      maxDiscountPct: Math.round(3 + rng() * 7), // 3%..10%
      maxInstalments: Math.round(2 + rng() * 3), // 2..5
      autoApproveMaxAmount: Math.round(300 + rng() * 700) * 100, // $300..$1000
      requireApprovalFor: ['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'],
      quietHours: { startHour: 20, endHour: 8 },
      maxRemindersPerInvoicePerWeek: 2,
    };

    snapshots.push({
      business: {
        id: `biz_${s}`,
        name: `Acme ${s}`,
        currency: 'USD',
        asOf,
        startingBalance,
        reserveThreshold,
      },
      payers,
      invoices,
      obligations: [
        {
          id: `ob_${s}_1`,
          label: 'Payroll',
          kind: 'payroll',
          amount: Math.round(2000 + rng() * 3000) * 100,
          dueDate: addDays(asOf, 5),
        },
      ],
      policy,
    });
  }

  return snapshots;
}

async function main() {
  const { provider, engine: engineType } = parseArgs();
  console.log(`=== Settle Evaluation (Provider: ${provider}, Engine: ${engineType}) ===\n`);

  let engine: EnginePort;
  if (engineType === 'real') {
    try {
      // @ts-expect-error dynamic import of real engine
      const realPkg = await import('@settle/engine');
      engine = realPkg.createEngine ? realPkg.createEngine() : new realPkg.Engine();
      console.log('Using real engine from @settle/engine.');
    } catch {
      throw new Error(
        'Real engine package "@settle/engine" could not be loaded. Please ensure it is installed and merged.',
      );
    }
  } else {
    engine = new FakeEngine({ defaultClosesGap: true });
  }

  const envCopy = { ...process.env, LLM_PROVIDER: provider };
  let llm;
  if (provider === 'mock') {
    llm = new MockLlm({ mode: 'good' });
  } else {
    llm = createLlmFromEnv(envCopy);
  }

  const snapshots = generateDeterministicSnapshots(20);
  const clock = new FixedClock('2026-11-05T10:00:00Z');

  let totalDecisions = 0;
  let totalLlmValid = 0;
  let totalFallbacks = 0;
  let totalRetries = 0;
  let totalGroundingFailures = 0;

  let countBlocked = 0;
  let countAwaiting = 0;
  let countApproved = 0;
  let countEscalate = 0;

  const failingCases: Array<{ snapshot: number; invoice: string; error: string }> = [];

  const startTime = Date.now();

  for (let idx = 0; idx < snapshots.length; idx++) {
    const snapshot = snapshots[idx]!;
    const idGen = new DeterministicIdGen();
    const agent = createAgent({
      engine,
      llm,
      clock,
      idGen,
    });

    try {
      const result = await agent.runCycle(snapshot);
      const metrics = agent.getLastRunMetrics();

      totalDecisions += metrics.decisions;
      totalLlmValid += metrics.llmValid;
      totalFallbacks += metrics.fallbacks;
      totalRetries += metrics.retries;
      totalGroundingFailures += metrics.groundingFailures;

      for (const act of result.actions) {
        if (act.status === 'BLOCKED') countBlocked++;
        if (act.status === 'AWAITING_APPROVAL') countAwaiting++;
        if (act.status === 'APPROVED') countApproved++;
        if (act.type === 'ESCALATE') countEscalate++;
      }
    } catch (err) {
      failingCases.push({
        snapshot: idx + 1,
        invoice: 'all',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const elapsedMs = Date.now() - startTime;
  const llmDecisions = totalLlmValid + totalFallbacks;
  const validOutputRate =
    llmDecisions > 0 ? (totalLlmValid / llmDecisions) * 100 : 100;
  const fallbackRate =
    llmDecisions > 0 ? (totalFallbacks / llmDecisions) * 100 : 0;

  console.log('Evaluation Results:');
  console.log('----------------------------------------------------');
  console.log(`Total Snapshots Evaluated : ${snapshots.length}`);
  console.log(`Total Action Decisions    : ${totalDecisions}`);
  console.log(`LLM Decisions Evaluated   : ${llmDecisions}`);
  console.log(`Valid Output Rate         : ${validOutputRate.toFixed(1)}%`);
  console.log(`Fallback Rate             : ${fallbackRate.toFixed(1)}%`);
  console.log(`Retries Triggered         : ${totalRetries}`);
  console.log(`Grounding Failures        : ${totalGroundingFailures}`);
  console.log('----------------------------------------------------');
  console.log('Action Status Distribution:');
  console.log(`  - APPROVED              : ${countApproved}`);
  console.log(`  - AWAITING_APPROVAL     : ${countAwaiting}`);
  console.log(`  - BLOCKED               : ${countBlocked}`);
  console.log(`  - ESCALATE Actions      : ${countEscalate}`);
  console.log('----------------------------------------------------');
  console.log(`Total Elapsed Time        : ${elapsedMs}ms`);
  console.log('----------------------------------------------------\n');

  if (failingCases.length > 0) {
    console.error('Failing Cases Encountered:');
    for (const fc of failingCases) {
      console.error(`  Snapshot #${fc.snapshot} (${fc.invoice}): ${fc.error}`);
    }
  }

  // Acceptance threshold:
  // Mock must be 100%. Real provider must be >= 95%.
  const minRequiredRate = provider === 'mock' ? 100 : 95;

  if (validOutputRate < minRequiredRate) {
    console.error(
      `FAILURE: Valid output rate ${validOutputRate.toFixed(1)}% is below required ${minRequiredRate}%.`,
    );
    process.exit(1);
  }

  console.log('EVALUATION PASSED: All requirements and thresholds satisfied.');
}

main().catch((err) => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});

