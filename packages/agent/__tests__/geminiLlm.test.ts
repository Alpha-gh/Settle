import { describe, expect, it } from 'vitest';
import { GeminiLlm } from '../src/llm/geminiLlm.js';

describe('GeminiLlm request settings and thought token handling', () => {
  it('sends maxOutputTokens >= 2048, temperature 0, and thinkingConfig for thinking models', async () => {
    let capturedBody: any = null;

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: JSON.stringify({ optionId: 'opt_1', reason: 'Verified' }) },
                ],
              },
            },
          ],
        }),
      } as any;
    };

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchFn: mockFetch as any,
    });

    const res = await llm.generateStructured<{ optionId: string; reason: string }>({
      system: 'system prompt',
      user: 'user prompt',
      jsonSchema: { type: 'object' },
    });

    expect(res.optionId).toBe('opt_1');
    expect(capturedBody).toBeDefined();
    expect(capturedBody.generationConfig.temperature).toBe(0);
    expect(capturedBody.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048);
    expect(capturedBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('correctly parses structured JSON when candidates contain thought tokens', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Step 1: Inspecting options. Option 2 closes shortfall gap.',
                },
                {
                  text: JSON.stringify({
                    optionId: 'opt_2',
                    reason: 'Extends due date to close shortfall of $200.00',
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      model: 'gemini-2.0-flash-thinking-exp',
      fetchFn: mockFetch as any,
    });

    const res = await llm.generateStructured<{ optionId: string; reason: string }>({
      system: 'system prompt',
      user: 'user prompt',
      jsonSchema: { type: 'object' },
    });

    expect(res.optionId).toBe('opt_2');
    expect(res.reason).toBe('Extends due date to close shortfall of $200.00');
  });

  it('ignores thought tokens in runWithTools', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Considering tool execution...',
                },
                {
                  text: 'All tasks completed successfully.',
                },
              ],
            },
          },
        ],
      }),
    });

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      fetchFn: mockFetch as any,
    });

    const res = await llm.runWithTools({
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      maxSteps: 1,
    });

    expect(res.text).toBe('All tasks completed successfully.');
    expect(res.toolCalls).toHaveLength(0);
  });
});
