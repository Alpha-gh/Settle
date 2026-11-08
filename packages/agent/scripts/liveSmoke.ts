import process from 'node:process';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { DeterministicIdGen } from '../src/ids.js';
import { createLlmFromEnv } from '../src/llm/factory.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

// Try loading local .env if supported
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // .env file not found or already loaded
}

async function main() {
  const provider = (process.env.LLM_PROVIDER || '').trim().toLowerCase();

  const hasKey =
    (provider === 'gemini' && !!process.env.GEMINI_API_KEY) ||
    (provider === 'anthropic' && !!process.env.ANTHROPIC_API_KEY) ||
    (provider === 'openai' && !!process.env.OPENAI_API_KEY);

  if (!hasKey) {
    console.log(
      'SKIPPED: Real LLM provider API key not configured (set LLM_PROVIDER and key in .env).',
    );
    process.exit(0);
  }

  console.log(`Running live smoke test with provider: ${provider}...`);

  const llm = createLlmFromEnv(process.env);
  const snapshot = buildSnapshot();
  // Limit to 1 invoice for quick smoke check
  snapshot.invoices = snapshot.invoices.slice(0, 1);

  const engine = new FakeEngine({
    closesGapMap: {
      inv_001: true,
    },
  });
  const clock = new FixedClock('2026-11-05T10:00:00Z');
  const idGen = new DeterministicIdGen();

  const agent = createAgent({
    engine,
    llm,
    clock,
    idGen,
  });

  // 1. One decision
  console.log('Testing live decision...');
  const runResult = await agent.runCycle(snapshot);
  const action = runResult.actions[0];
  if (!action) {
    throw new Error('Expected at least one action record in runCycle result');
  }
  console.log(`Decision: ${action.type} [${action.status}]`);
  console.log(`Reason: ${action.reason}`);
  if (action.params.note) {
    console.log(`Draft note: ${action.params.note}`);
  }

  // 2. One chat question
  console.log('\nTesting live chat question...');
  const question = 'Can I cover payroll on Friday?';
  const chatAnswer = await agent.chat(question, snapshot);
  console.log(`Question: "${question}"`);
  console.log(`Answer: ${chatAnswer.text}`);
  console.log(`Tool calls made: ${chatAnswer.toolCalls.length}`);

  console.log('\nLive smoke test PASSED successfully!');
}

main().catch((err) => {
  console.error('Live smoke test FAILED:', err);
  process.exit(1);
});

