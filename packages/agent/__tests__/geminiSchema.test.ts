import { describe, expect, it } from 'vitest';
import { sanitizeGeminiSchema } from '../src/llm/geminiSchema.js';
import { GeminiLlm } from '../src/llm/geminiLlm.js';
import { buildDecisionSchema } from '../src/schema.js';

describe('Gemini Schema Sanitizer and GenerationConfig Inspection (Tasks 1, 2, 5, 6)', () => {
  // ── Task 1: Print exact generation_config sent for decision flow and for ping ──
  it('Task 1: prints the exact generation_config object sent for decision flow and ping', async () => {
    let capturedBodyDecision: any = null;
    let capturedBodyPing: any = null;

    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const redactedUrl = urlStr.replace(/key=[^&\s]+/g, 'key=[REDACTED]');
      const body = JSON.parse(init?.body as string);
      if (body.contents[0].parts[0].text.includes('PING_TEST')) {
        capturedBodyPing = body;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify({ reply: 'ok' }) }] },
                finishReason: 'STOP',
              },
            ],
          }),
        } as any;
      } else {
        capturedBodyDecision = body;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        optionId: 'opt_1',
                        reason: 'Extends invoice due date to close shortfall of $200.00',
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        } as any;
      }
    };

    const llm = new GeminiLlm({
      apiKey: 'secret-key-12345',
      model: 'gemini-3.6-flash',
      fetchFn: mockFetch as any,
    });

    // 1. Decision flow
    const decisionSchema = buildDecisionSchema(['opt_1', 'opt_2', 'escalate']).jsonSchema;
    await llm.generateStructured<{ optionId: string; reason: string }>({
      system: 'You are an accounts-receivable decision agent.',
      user: 'Choose candidate option for Maya Studio invoice inv_001.',
      jsonSchema: decisionSchema,
    });

    // 2. Ping flow
    const pingSchema = {
      type: 'object' as const,
      properties: {
        reply: { type: 'string' as const },
      },
      required: ['reply'] as ['reply'],
    };
    await llm.generateStructured<{ reply: string }>({
      system: 'PING_TEST probe',
      user: 'reply with ok',
      jsonSchema: pingSchema,
    });

    console.log(
      '=== [TASK 1] Exact generation_config for DECISION FLOW ===\n' +
        JSON.stringify(capturedBodyDecision.generationConfig, null, 2),
    );
    console.log(
      '=== [TASK 1] Exact generation_config for PING FLOW ===\n' +
        JSON.stringify(capturedBodyPing.generationConfig, null, 2),
    );

    // Assertions on decision generationConfig
    expect(capturedBodyDecision.generationConfig.temperature).toBe(0);
    expect(capturedBodyDecision.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048);
    expect(capturedBodyDecision.generationConfig.responseMimeType).toBe('application/json');
    expect(capturedBodyDecision.generationConfig.responseSchema).toBeDefined();
    expect(capturedBodyDecision.generationConfig.responseSchema.type).toBe('object');
    expect(capturedBodyDecision.generationConfig.responseSchema.properties.optionId).toBeDefined();
    expect(capturedBodyDecision.generationConfig.responseSchema.properties.reason).toBeDefined();
    expect(capturedBodyDecision.generationConfig.responseSchema.required).toEqual(['optionId', 'reason']);
    // Prohibited keywords must be absent
    expect(capturedBodyDecision.generationConfig.responseSchema.additionalProperties).toBeUndefined();
    expect(capturedBodyDecision.generationConfig.responseSchema.$schema).toBeUndefined();
    expect(capturedBodyDecision.generationConfig.responseSchema.title).toBeUndefined();

    // Assertions on ping generationConfig
    expect(capturedBodyPing.generationConfig.responseSchema.type).toBe('object');
    expect(capturedBodyPing.generationConfig.responseSchema.properties.reply).toBeDefined();
    expect(capturedBodyPing.generationConfig.responseSchema.required).toEqual(['reply']);
  });

  // ── Task 2 & 6: Sanitizer on Zod-generated schema with $ref, definitions, nullable, const, required ──
  it('Task 2 & 6: sanitizes schemas with $ref/definitions, const, nullable, and required mismatch', () => {
    const zodGeneratedSchemaFixture = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: '#/definitions/ComplexModel',
      definitions: {
        ComplexModel: {
          type: 'object',
          properties: {
            actionType: {
              type: 'string',
              const: 'DISCOUNT',
            },
            note: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
            },
            user: {
              $ref: '#/definitions/User',
            },
            count: {
              type: 'number',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['actionType', 'nonExistentProperty123'],
          additionalProperties: false,
          title: 'ComplexModelTitle',
          default: {},
          examples: ['example1'],
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
          additionalProperties: false,
          title: 'UserTitle',
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(zodGeneratedSchemaFixture) as any;

    // 1. $ref and definitions must be completely inlined and definitions dropped
    expect(sanitized.$ref).toBeUndefined();
    expect(sanitized.$defs).toBeUndefined();
    expect(sanitized.definitions).toBeUndefined();
    expect(sanitized.$schema).toBeUndefined();
    expect(sanitized.title).toBeUndefined();
    expect(sanitized.additionalProperties).toBeUndefined();
    expect(sanitized.default).toBeUndefined();
    expect(sanitized.examples).toBeUndefined();

    // 2. Properties must be preserved and nested objects inlined
    expect(sanitized.type).toBe('object');
    expect(sanitized.properties).toBeDefined();
    expect(sanitized.properties.actionType).toBeDefined();
    expect(sanitized.properties.user).toBeDefined();
    expect(sanitized.properties.user.type).toBe('object');
    expect(sanitized.properties.user.properties.id).toBeDefined();
    expect(sanitized.properties.user.properties.name).toBeDefined();

    // 3. Const must be converted to enum
    expect(sanitized.properties.actionType.const).toBeUndefined();
    expect(sanitized.properties.actionType.enum).toEqual(['DISCOUNT']);

    // 4. Nullable must be set on note
    expect(sanitized.properties.note.nullable).toBe(true);

    // 5. nonExistentProperty123 in required must be dropped because it is not in properties
    expect(sanitized.required).toContain('actionType');
    expect(sanitized.required).not.toContain('nonExistentProperty123');
    for (const reqProp of sanitized.required) {
      expect(sanitized.properties[reqProp]).toBeDefined();
    }
  });

  // ── Task 6: Decision schema end to end through sanitizer ──
  it('Task 6: decision schema end to end passes sanitizer with valid properties and required list', () => {
    const rawDecision = buildDecisionSchema(['opt_1', 'opt_2', 'escalate']).jsonSchema;
    const sanitized = sanitizeGeminiSchema(rawDecision) as any;

    expect(sanitized.type).toBe('object');
    expect(sanitized.properties.optionId).toBeDefined();
    expect(sanitized.properties.optionId.type).toBe('string');
    expect(sanitized.properties.optionId.enum).toEqual(['opt_1', 'opt_2', 'escalate']);
    expect(sanitized.properties.reason).toBeDefined();
    expect(sanitized.properties.reason.type).toBe('string');
    expect(sanitized.required).toEqual(['optionId', 'reason']);
    expect(sanitized.additionalProperties).toBeUndefined();
  });

  // ── Task 6: Mocked Gemini response containing thought parts plus thoughtSignature plus JSON ──
  it('Task 6: parses response with thought parts, thoughtSignature, and JSON text correctly', async () => {
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
                  text: 'Let me think about option 1 vs option 2...',
                },
                {
                  thoughtSignature: 'sig_abc_12345',
                  text: 'Hidden reasoning signature token',
                },
                {
                  text: JSON.stringify({
                    optionId: 'opt_1',
                    reason: 'Offer 3% discount to recover cash early',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    });

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      fetchFn: mockFetch as any,
    });

    const res = await llm.generateStructured<{ optionId: string; reason: string }>({
      system: 'system prompt',
      user: 'user prompt',
      jsonSchema: { type: 'object' },
    });

    expect(res.optionId).toBe('opt_1');
    expect(res.reason).toBe('Offer 3% discount to recover cash early');
  });

  // ── Task 5 & 6: finishReason MAX_TOKENS produces clear error ──
  it('Task 5 & 6: finishReason MAX_TOKENS produces clear truncated error', async () => {
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
                  text: '{"optionId": "opt_1", "reason": "Cut off mid way',
                },
              ],
            },
            finishReason: 'MAX_TOKENS',
          },
        ],
      }),
    });

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      fetchFn: mockFetch as any,
    });

    await expect(
      llm.generateStructured({
        system: 'system prompt',
        user: 'user prompt',
        jsonSchema: { type: 'object' },
      }),
    ).rejects.toThrow(/Gemini output truncated: finishReason=MAX_TOKENS/);
  });

  // ── Task 5: Safety block produces clear error ──
  it('Task 5: safety block produces clear error with finishReason', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [
          {
            finishReason: 'SAFETY',
          },
        ],
      }),
    });

    const llm = new GeminiLlm({
      apiKey: 'test-key',
      fetchFn: mockFetch as any,
    });

    await expect(
      llm.generateStructured({
        system: 'system prompt',
        user: 'user prompt',
        jsonSchema: { type: 'object' },
      }),
    ).rejects.toThrow(/Gemini response blocked by safety: finishReason=SAFETY/);
  });
});
