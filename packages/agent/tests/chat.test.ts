import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { checkGrounding } from '../src/grounding.js';
import { buildChatAllowedSet } from '../src/chat/chat.js';
import { DeterministicIdGen } from '../src/ids.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

describe('Stage 4 - Chat with Tools and Grounding', () => {
  function setupTest(mockLlmOptions: ConstructorParameters<typeof MockLlm>[0] = {}) {
    const snapshot = buildSnapshot();
    const engine = new FakeEngine({
      closesGapMap: {
        inv_001: true,
        inv_002: true,
      },
    });
    const llm = new MockLlm(mockLlmOptions);
    const clock = new FixedClock('2026-11-05T10:00:00Z');
    const idGen = new DeterministicIdGen();

    const agent = createAgent({
      engine,
      llm,
      clock,
      idGen,
    });

    return { agent, snapshot, engine, llm };
  }

  it('Question 1: "Can I cover payroll on Friday?" produces >=1 tool call, grounded text, and forecast populated', async () => {
    const { agent, snapshot } = setupTest({ mode: 'good' });
    const answer = await agent.chat('Can I cover payroll on Friday?', snapshot);

    expect(answer.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(answer.toolCalls.some((tc) => tc.name === 'get_forecast')).toBe(true);
    expect(answer.forecast).toBeDefined();

    // Verify grounding
    const allowed = buildChatAllowedSet(snapshot, answer.toolCalls);
    const ground = checkGrounding(answer.text, allowed);
    expect(ground.ok).toBe(true);
    expect(ground.offenders).toEqual([]);
  });

  it('Question 2: "What if I buy $3,000 of stock on Monday?" produces >=1 tool call, grounded text, comparison and forecast populated', async () => {
    const { agent, snapshot } = setupTest({ mode: 'good' });
    const answer = await agent.chat(
      'What if I buy $3,000 of stock on Monday?',
      snapshot,
    );

    expect(answer.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      answer.toolCalls.some((tc) => tc.name === 'simulate_scenario'),
    ).toBe(true);
    expect(answer.comparison).toBeDefined();
    expect(answer.forecast).toBeDefined();

    // Verify grounding
    const allowed = buildChatAllowedSet(snapshot, answer.toolCalls);
    const ground = checkGrounding(answer.text, allowed);
    expect(ground.ok).toBe(true);
    expect(ground.offenders).toEqual([]);
  });

  it('Question 3: "Which invoice should I chase first?" produces >=1 tool call, grounded text, comparison populated', async () => {
    const { agent, snapshot } = setupTest({ mode: 'good' });
    const answer = await agent.chat('Which invoice should I chase first?', snapshot);

    expect(answer.toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(
      answer.toolCalls.some((tc) => tc.name === 'list_overdue_invoices'),
    ).toBe(true);
    expect(answer.toolCalls.some((tc) => tc.name === 'compare_options')).toBe(true);
    expect(answer.comparison).toBeDefined();

    // Verify grounding
    const allowed = buildChatAllowedSet(snapshot, answer.toolCalls);
    const ground = checkGrounding(answer.text, allowed);
    expect(ground.ok).toBe(true);
    expect(ground.offenders).toEqual([]);
  });

  it('Out-of-scope question: "Write me a poem about cats" gives a brief refusal and zero tool calls', async () => {
    const { agent, snapshot } = setupTest({ mode: 'good' });
    const answer = await agent.chat('Write me a poem about cats', snapshot);

    expect(answer.toolCalls).toHaveLength(0);
    expect(answer.comparison).toBeUndefined();
    expect(answer.forecast).toBeUndefined();
    expect(answer.text.toLowerCase()).toContain('only');
    expect(answer.text.toLowerCase()).toContain('cash flow');
  });

  it('Model answer with ungrounded $9,999 is rejected, retried, then replaced by factual template', async () => {
    // Force MockLlm to emit ungrounded text with $9,999
    const { agent, snapshot } = setupTest({
      chatResponseOverride:
        'Based on calculations, you will have $9,999 left in your reserve account.',
    });

    const answer = await agent.chat('Can I cover payroll on Friday?', snapshot);

    // Initial output containing $9,999 must have been replaced by the template
    expect(answer.text).not.toContain('$9,999');
    expect(answer.text).toContain('Cash flow forecast:');
    // Grounding on final text must pass completely
    const allowed = buildChatAllowedSet(snapshot, answer.toolCalls);
    const ground = checkGrounding(answer.text, allowed);
    expect(ground.ok).toBe(true);
    expect(ground.offenders).toEqual([]);
  });

  it('maxSteps is never exceeded in chat tool execution', async () => {
    const { snapshot, engine } = setupTest();
    let executedSteps = 0;

    const countingLlm: MockLlm = new MockLlm();
    countingLlm.runWithTools = async (a) => {
      // Loop tools respecting a.maxSteps
      for (let i = 0; i < 10; i++) {
        if (executedSteps >= a.maxSteps) break;
        const tool = a.tools[0];
        if (tool) {
          executedSteps++;
          await tool.run({});
        }
      }
      return { text: 'Done', toolCalls: [] };
    };

    const clock = new FixedClock('2026-11-05T10:00:00Z');
    const idGen = new DeterministicIdGen();
    const agent = createAgent({
      engine,
      llm: countingLlm,
      clock,
      idGen,
    });

    await agent.chat('Can I cover payroll on Friday?', snapshot);
    expect(executedSteps).toBeLessThanOrEqual(4);
  });
});

