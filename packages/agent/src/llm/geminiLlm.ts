import type { LlmPort } from '@settle/shared';
import {
  LlmHttpError,
  LlmMalformedOutputError,
  LlmTimeoutError,
} from './errors.js';

// NOTE: Please confirm current model IDs in the official Google Gemini API documentation.
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';

export interface GeminiLlmOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function sanitizeGeminiSchema(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw.map(sanitizeGeminiSchema);
  }

  const obj = raw as Record<string, unknown>;
  const clean: Record<string, unknown> = {};

  const allowedKeys = [
    'type',
    'format',
    'description',
    'nullable',
    'enum',
    'properties',
    'required',
    'items',
  ];

  for (const key of Object.keys(obj)) {
    if (key === 'additionalProperties' || key === '$schema' || key === 'title') {
      continue;
    }
    if (allowedKeys.includes(key)) {
      clean[key] = sanitizeGeminiSchema(obj[key]);
    }
  }

  return clean;
}

export class GeminiLlm implements LlmPort {
  public readonly info: { provider: string; model: string };
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiLlmOptions) {
    this.apiKey = options.apiKey;
    this.model =
      options.model ||
      process.env.GEMINI_MODEL ||
      DEFAULT_GEMINI_MODEL;
    this.timeoutMs =
      options.timeoutMs ??
      (process.env.LLM_TIMEOUT_MS
        ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
        : 15000);
    this.fetchFn = options.fetchFn ?? fetch;
    this.info = {
      provider: 'gemini',
      model: this.model,
    };
  }

  private async postJson(url: string, payload: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new LlmHttpError(res.status, res.statusText, bodyText);
      }

      return await res.json();
    } catch (err) {
      if (err instanceof LlmHttpError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        controller.signal.aborted
      ) {
        throw new LlmTimeoutError(
          `Gemini request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateStructured<R>(a: {
    system: string;
    user: string;
    jsonSchema: object;
  }): Promise<R> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const sanitizedSchema = sanitizeGeminiSchema(a.jsonSchema);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${a.system}\n\n${a.user}` }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: sanitizedSchema,
      },
    };

    const data = await this.postJson(endpoint, body);
    const candidate = data?.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      throw new LlmMalformedOutputError(
        'Gemini response did not contain candidates[0].content.parts[0].text',
      );
    }

    try {
      return JSON.parse(textPart) as R;
    } catch (parseErr) {
      throw new LlmMalformedOutputError(
        `Failed to parse Gemini JSON output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
  }

  async runWithTools(a: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: {
      name: string;
      description: string;
      jsonSchema: object;
      run(args: any): Promise<unknown>;
    }[];
    maxSteps: number;
  }): Promise<{
    text: string;
    toolCalls: { name: string; args: unknown; result: unknown }[];
  }> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const toolMap = new Map(a.tools.map((t) => [t.name, t]));
    const executedCalls: { name: string; args: unknown; result: unknown }[] = [];

    const functionDeclarations = a.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeGeminiSchema(t.jsonSchema),
    }));

    // Convert conversation to Gemini contents
    const contents: any[] = [];
    if (a.system) {
      contents.push({
        role: 'user',
        parts: [{ text: `SYSTEM INSTRUCTIONS:\n${a.system}` }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow all instructions.' }],
      });
    }

    for (const msg of a.messages) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    let finalAnswer = '';
    const max = Math.max(1, a.maxSteps);

    for (let step = 0; step < max; step++) {
      const body = {
        contents,
        tools: [{ functionDeclarations }],
        generationConfig: { temperature: 0 },
      };

      const data = await this.postJson(endpoint, body);
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts;

      if (!parts || parts.length === 0) {
        throw new LlmMalformedOutputError('Gemini returned empty parts');
      }

      let hadFunctionCall = false;

      for (const part of parts) {
        if (part.functionCall) {
          hadFunctionCall = true;
          const fnName = part.functionCall.name;
          const fnArgs = part.functionCall.args ?? {};
          const tool = toolMap.get(fnName);

          let toolResult: unknown;
          if (tool) {
            toolResult = await tool.run(fnArgs);
          } else {
            toolResult = { error: `Tool ${fnName} not found` };
          }

          executedCalls.push({
            name: fnName,
            args: fnArgs,
            result: toolResult,
          });

          // Append model functionCall and user functionResponse
          contents.push({
            role: 'model',
            parts: [{ functionCall: part.functionCall }],
          });
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: fnName,
                  response: { result: toolResult },
                },
              },
            ],
          });
        } else if (part.text) {
          finalAnswer = part.text;
        }
      }

      if (!hadFunctionCall) {
        break;
      }
    }

    return {
      text: finalAnswer,
      toolCalls: executedCalls,
    };
  }
}

