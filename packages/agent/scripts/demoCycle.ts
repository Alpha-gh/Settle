import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { DeterministicIdGen } from '../src/ids.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

async function main() {
  const snapshot = buildSnapshot();
  const engine = new FakeEngine({
    closesGapMap: {
      'inv_001': true,
      'inv_002': true,
    },
  });
  const llm = new MockLlm({ mode: 'good' });
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

  for (const action of result.actions) {
    const inv = invoiceMap.get(action.invoiceId);
    const invoiceNum = inv ? inv.number : action.invoiceId;
    console.log(`${invoiceNum} | ${action.type} | ${action.status} | ${action.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

