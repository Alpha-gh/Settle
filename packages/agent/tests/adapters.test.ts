import { describe, expect, it } from 'vitest';
import { AnthropicLlm } from '../src/llm/anthropicLlm.js';
import {
  LlmHttpError,
  LlmMalformedOutputError,
  LlmTimeoutError,
} from '../src/llm/errors.js';
import { createLlmFromEnv } from '../src/llm/factory.js';
import { GeminiLlm } from '../src/llm/geminiLlm.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { OpenAiLlm } from '../src/llm/openAiLlm.js';

describe('Stage 4 - LLM Provider Adapters and Factory', () => {
  describe('createLlmFromEnv factory', () => {
    it('defaults to MockLlm when LLM_PROVIDER is unset or "mock"', () => {
      const llm1 = createLlmFromEnv({});
      expect(llm1).toBeInstanceOf(MockLlm);

      const llm2 = createLlmFromEnv({ LLM_PROVIDER: 'mock' });
      expect(llm2).toBeInstanceOf(MockLlm);
    });

    it('throws descriptive error if GEMINI_API_KEY is missing when provider is gemini', () => {
      expect(() => createLlmFromEnv({ LLM_PROVIDER: 'gemini' })).toThrowError(
        'GEMINI_API_KEY is required when LLM_PROVIDER=gemini',
      );
    });

    it('throws descriptive error if ANTHROPIC_API_KEY is missing when provider is anthropic', () => {
      expect(() =>
        createLlmFromEnv({ LLM_PROVIDER: 'anthropic' }),
      ).toThrowError(
        'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
      );
    });

    it('throws descriptive error if OPENAI_API_KEY is missing when provider is openai', () => {
      expect(() => createLlmFromEnv({ LLM_PROVIDER: 'openai' })).toThrowError(
        'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
      );
    });

    it('throws descriptive error for unknown provider', () => {
      expect(() => createLlmFromEnv({ LLM_PROVIDER: 'deepseek' })).toThrowError(
        'Unknown LLM_PROVIDER "deepseek"',
      );
    });
  });

  describe('GeminiLlm adapter', () => {
    it('sends correct request shape and parses structured output', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;

      const stubFetch: typeof fetch = async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ optionId: 'opt_1', reason: 'Verified' }) }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const gemini = new GeminiLlm({
        apiKey: 'test-gemini-key',
        model: 'gemini-1.5-flash',
        fetchFn: stubFetch,
      });

      const res = await gemini.generateStructured<{ optionId: string; reason: string }>({
        system: 'System instructions',
        user: 'User prompt',
        jsonSchema: {
          type: 'object',
          properties: { optionId: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
      });

      expect(res.optionId).toBe('opt_1');
      expect(res.reason).toBe('Verified');
      expect(capturedUrl).toContain('test-gemini-key');
      expect(capturedBody.generationConfig.temperature).toBe(0);
      // Verify additionalProperties was sanitized
      expect(capturedBody.generationConfig.responseSchema.additionalProperties).toBeUndefined();
    });

    it('executes tool loop and feeds functionResponse back', async () => {
      let callCount = 0;
      const stubFetch: typeof fetch = async (_url, _init) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'lookup',
                          args: { query: 'test' },
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Lookup answered: test-result' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const gemini = new GeminiLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      let toolExecuted = false;
      const result = await gemini.runWithTools({
        system: 'Sys',
        messages: [{ role: 'user', content: 'Do lookup' }],
        tools: [
          {
            name: 'lookup',
            description: 'test lookup',
            jsonSchema: { type: 'object' },
            run: async (args: any) => {
              toolExecuted = true;
              return { echo: args.query };
            },
          },
        ],
        maxSteps: 3,
      });

      expect(toolExecuted).toBe(true);
      expect(result.text).toBe('Lookup answered: test-result');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('lookup');
    });

    it('rejects on HTTP 429/500 with typed LlmHttpError', async () => {
      const stubFetch: typeof fetch = async () => {
        return new Response('Rate limit reached', {
          status: 429,
          statusText: 'Too Many Requests',
        });
      };

      const gemini = new GeminiLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      await expect(
        gemini.generateStructured({
          system: '',
          user: '',
          jsonSchema: {},
        }),
      ).rejects.toThrow(LlmHttpError);
    });

    it('rejects on malformed output with LlmMalformedOutputError', async () => {
      const stubFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const gemini = new GeminiLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      await expect(
        gemini.generateStructured({
          system: '',
          user: '',
          jsonSchema: {},
        }),
      ).rejects.toThrow(LlmMalformedOutputError);
    });
  });

  describe('AnthropicLlm adapter', () => {
    it('sends correct request shape with tool_choice and returns structured output', async () => {
      let capturedHeaders: any = null;
      let capturedBody: any = null;

      const stubFetch: typeof fetch = async (_url, init) => {
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                name: 'structured_output',
                input: { score: 95 },
              },
            ],
            stop_reason: 'tool_use',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const anthropic = new AnthropicLlm({
        apiKey: 'test-claude-key',
        fetchFn: stubFetch,
      });

      const res = await anthropic.generateStructured<{ score: number }>({
        system: 'System msg',
        user: 'User msg',
        jsonSchema: { type: 'object', properties: { score: { type: 'integer' } } },
      });

      expect(res.score).toBe(95);
      expect(capturedHeaders['x-api-key']).toBe('test-claude-key');
      expect(capturedBody.temperature).toBe(0);
      expect(capturedBody.tool_choice.type).toBe('tool');
    });

    it('handles tool loop with tool_result blocks', async () => {
      let callCount = 0;
      const stubFetch: typeof fetch = async (_url, _init) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              stop_reason: 'tool_use',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_123',
                  name: 'calc',
                  input: { n: 10 },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Calc result was 20' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const anthropic = new AnthropicLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      const result = await anthropic.runWithTools({
        system: 'Sys',
        messages: [{ role: 'user', content: 'Calculate' }],
        tools: [
          {
            name: 'calc',
            description: 'calc tool',
            jsonSchema: {},
            run: async (args: any) => ({ doubled: args.n * 2 }),
          },
        ],
        maxSteps: 3,
      });

      expect(result.text).toBe('Calc result was 20');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('calc');
    });

    it('rejects on timeout with LlmTimeoutError', async () => {
      const stubFetch: typeof fetch = async (_url, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      };

      const anthropic = new AnthropicLlm({
        apiKey: 'test-key',
        timeoutMs: 10,
        fetchFn: stubFetch,
      });

      await expect(
        anthropic.generateStructured({
          system: '',
          user: '',
          jsonSchema: {},
        }),
      ).rejects.toThrow(LlmTimeoutError);
    });
  });

  describe('OpenAiLlm adapter', () => {
    it('sends correct request shape with response_format json_schema', async () => {
      let capturedHeaders: any = null;
      let capturedBody: any = null;

      const stubFetch: typeof fetch = async (_url, init) => {
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ acknowledged: true }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const openai = new OpenAiLlm({
        apiKey: 'test-openai-key',
        fetchFn: stubFetch,
      });

      const res = await openai.generateStructured<{ acknowledged: boolean }>({
        system: 'System msg',
        user: 'User msg',
        jsonSchema: { type: 'object' },
      });

      expect(res.acknowledged).toBe(true);
      expect(capturedHeaders['Authorization']).toBe('Bearer test-openai-key');
      expect(capturedBody.response_format.type).toBe('json_schema');
      expect(capturedBody.temperature).toBe(0);
    });

    it('handles tool loop with role: tool feedback', async () => {
      let callCount = 0;
      const stubFetch: typeof fetch = async (_url, _init) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: 'tc_1',
                        function: {
                          name: 'check_status',
                          arguments: '{"id":"123"}',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Status is active',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const openai = new OpenAiLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      const result = await openai.runWithTools({
        system: 'Sys',
        messages: [{ role: 'user', content: 'Check' }],
        tools: [
          {
            name: 'check_status',
            description: 'check status',
            jsonSchema: {},
            run: async () => ({ status: 'active' }),
          },
        ],
        maxSteps: 3,
      });

      expect(result.text).toBe('Status is active');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('check_status');
    });

    it('rejects on HTTP 503 with typed LlmHttpError', async () => {
      const stubFetch: typeof fetch = async () => {
        return new Response('Service Unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      };

      const openai = new OpenAiLlm({
        apiKey: 'test-key',
        fetchFn: stubFetch,
      });

      await expect(
        openai.generateStructured({
          system: '',
          user: '',
          jsonSchema: {},
        }),
      ).rejects.toThrow(LlmHttpError);
    });
  });
});

