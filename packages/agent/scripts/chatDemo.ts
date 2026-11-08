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
      inv_001: true,
      inv_002: true,
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

  const questions = [
    'Can I cover payroll on Friday?',
    'What if I buy $3,000 of stock on Monday?',
    'Which invoice should I chase first?',
  ];

  console.log('=== Settle Chat Demo ===\n');

  for (const q of questions) {
    console.log(`User: "${q}"`);
    const answer = await agent.chat(q, snapshot);
    console.log('Tool Calls:');
    for (const tc of answer.toolCalls) {
      console.log(`  - ${tc.name}(${JSON.stringify(tc.args)})`);
    }
    console.log(`Assistant: ${answer.text}`);
    if (answer.forecast) {
      console.log(`  [Forecast recorded: lowest $${(answer.forecast.lowest.amount / 100).toFixed(2)}]`);
    }
    if (answer.comparison) {
      console.log(`  [Comparison recorded: delta $${(answer.comparison.lowestDelta / 100).toFixed(2)}]`);
    }
    console.log('-----------------------------------------------------\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

