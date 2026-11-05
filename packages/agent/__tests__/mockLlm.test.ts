import { describe, expect, it } from 'vitest';
import { MockLlm } from '../src/llm/mockLlm.js';

describe('MockLlm', () => {
  const jsonSchema = {
    type: 'object',
    properties: {
      selectedOptionId: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['selectedOptionId', 'reason'],
  };

  it('good mode: given 3 candidates where only opt_2 closes the gap, it selects opt_2', async () => {
    const llm = new MockLlm({ mode: 'good' });
    const userPrompt = `
Facts:
- opt_1: closesGap=false, cashCost=100, lowestDelta=1000
- opt_2: closesGap=true, cashCost=300, lowestDelta=2000
- opt_3: closesGap=false, cashCost=50, lowestDelta=1500
    `;

    const res = await llm.generateStructured<{
      selectedOptionId: string;
      reason: string;
    }>({
      system: 'You are an accounts-receivable agent.',
      user: userPrompt,
      jsonSchema,
    });

    expect(res.selectedOptionId).toBe('opt_2');
    expect(res.reason).toContain('opt_2');
    expect(res.reason).toContain('300');
    expect(res.reason).toContain('2000');
  });

  it('good mode: given none closing, it picks the largest lowestDelta', async () => {
    const llm = new MockLlm({ mode: 'good' });
    const userPrompt = `
Facts:
- opt_1: closesGap=false, cashCost=50, lowestDelta=1000
- opt_2: closesGap=false, cashCost=100, lowestDelta=1500
- opt_3: closesGap=false, cashCost=200, lowestDelta=2500
    `;

    const res = await llm.generateStructured<{
      selectedOptionId: string;
      reason: string;
    }>({
      system: 'You are an accounts-receivable agent.',
      user: userPrompt,
      jsonSchema,
    });

    expect(res.selectedOptionId).toBe('opt_3');
    expect(res.reason).toContain('opt_3');
    expect(res.reason).toContain('2500');
  });

  it('failure mode: invalidJson throws simulated syntax error', async () => {
    const llm = new MockLlm({ mode: 'invalidJson' });
    await expect(
      llm.generateStructured({
        system: '',
        user: 'opt_1',
        jsonSchema,
      }),
    ).rejects.toThrow(/invalid json/i);
  });

  it('failure mode: unknownId returns an unlisted id', async () => {
    const llm = new MockLlm({ mode: 'unknownId' });
    const res = await llm.generateStructured<{
      selectedOptionId: string;
      reason: string;
    }>({
      system: '',
      user: '- opt_1: closesGap=true, cashCost=100, lowestDelta=500',
      jsonSchema,
    });

    expect(res.selectedOptionId).toBe('opt_unknown_999');
    expect(res.reason).toContain('opt_unknown_999');
  });

  it('failure mode: ungroundedNumber returns hallucinations in reason', async () => {
    const llm = new MockLlm({ mode: 'ungroundedNumber' });
    const res = await llm.generateStructured<{
      selectedOptionId: string;
      reason: string;
    }>({
      system: '',
      user: '- opt_1: closesGap=true, cashCost=100, lowestDelta=500',
      jsonSchema,
    });

    expect(res.reason).toMatch(/99999%|\$999,999/);
  });

  it('failure mode: slow simulates delay', async () => {
    const llm = new MockLlm({ mode: 'slow', slowDelayMs: 60 });
    const start = Date.now();
    await llm.generateStructured({
      system: '',
      user: '- opt_1: closesGap=true, cashCost=100, lowestDelta=500',
      jsonSchema,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });
});

