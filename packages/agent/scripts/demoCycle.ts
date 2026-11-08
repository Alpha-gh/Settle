import process from 'node:process';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { draftNote } from '../src/draftNote.js';
import { DeterministicIdGen } from '../src/ids.js';
import { createLlmFromEnv } from '../src/llm/factory.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // .env file not found or already loaded
}

async function main() {
  const snapshot = buildSnapshot();
  const engine = new FakeEngine({
    closesGapMap: {
      inv_001: true,
      inv_002: true,
    },
  });
  let llm;
  try {
    llm = createLlmFromEnv(process.env);
  } catch {
    llm = new MockLlm({ mode: 'good' });
  }
  const clock = new FixedClock('2026-11-05T10:00:00Z');
  const idGen = new DeterministicIdGen();

  const agent = createAgent({
    engine,
    llm,
    clock,
    idGen,
  });

  const result = await agent.runCycle(snapshot);
  const invoiceMap = new Map(snapshot.invoices.map((inv) => [inv.id, inv]));

  console.log('--- Agent Actions ---');
  for (const action of result.actions) {
    const inv = invoiceMap.get(action.invoiceId);
    const invoiceNum = inv ? inv.number : action.invoiceId;
    console.log(`${invoiceNum} | ${action.type} | ${action.status} | ${action.reason}`);
    if (action.params.note) {
      console.log(`  -> Draft Note: ${action.params.note}`);
    }
  }

  console.log('\n--- Sample notes ---');
  // 1. REMIND example
  const invRemind = snapshot.invoices.find((i) => i.id === 'inv_006')!;
  const payerRemind = snapshot.payers.find((p) => p.id === invRemind.payerId)!;
  const noteRemind = await draftNote(
    {
      action: { type: 'REMIND' },
      invoice: invRemind,
      payer: payerRemind,
      facts: { invoice: invRemind, payer: payerRemind, asOf: snapshot.business.asOf },
    },
    llm,
  );
  console.log(`REMIND Sample Note:\n${noteRemind}\n`);

  // 2. OFFER_DISCOUNT 3% example
  const invDisc = snapshot.invoices.find((i) => i.id === 'inv_001')!;
  const payerDisc = snapshot.payers.find((p) => p.id === invDisc.payerId)!;
  const remDisc = invDisc.amount - invDisc.amountPaid;
  const discAmount = Math.floor((remDisc * 3) / 100);
  const noteDisc = await draftNote(
    {
      action: { type: 'OFFER_DISCOUNT', params: { discountPct: 3 } },
      invoice: invDisc,
      payer: payerDisc,
      facts: {
        invoice: invDisc,
        payer: payerDisc,
        asOf: snapshot.business.asOf,
        change: {
          type: 'OFFER_DISCOUNT',
          invoiceId: invDisc.id,
          discountPct: 3,
          newExpectedDate: invDisc.dueDate,
        },
        discountedAmount: remDisc - discAmount,
      },
    },
    llm,
  );
  console.log(`OFFER_DISCOUNT 3% Sample Note:\n${noteDisc}\n`);

  // 3. OFFER_INSTALMENTS 3x30 example
  const invInst = snapshot.invoices.find((i) => i.id === 'inv_002')!;
  const payerInst = snapshot.payers.find((p) => p.id === invInst.payerId)!;
  const noteInst = await draftNote(
    {
      action: {
        type: 'OFFER_INSTALMENTS',
        params: { instalments: { count: 3, spacingDays: 30 } },
      },
      invoice: invInst,
      payer: payerInst,
      facts: {
        invoice: invInst,
        payer: payerInst,
        asOf: snapshot.business.asOf,
        change: {
          type: 'OFFER_INSTALMENTS',
          invoiceId: invInst.id,
          count: 3,
          spacingDays: 30,
          firstDate: invInst.dueDate,
        },
      },
    },
    llm,
  );
  console.log(`OFFER_INSTALMENTS 3x30 Sample Note:\n${noteInst}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
