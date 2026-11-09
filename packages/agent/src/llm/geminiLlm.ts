import type { LlmPort } from '@settle/shared';
import {
  LlmHttpError,
  LlmMalformedOutputError,
  LlmTimeoutError,
} from './errors.js';
import { sanitizeGeminiSchema } from './geminiSchema.js';

export { sanitizeGeminiSchema } from './geminiSchema.js';

// NOTE: Please confirm current model IDs in the official Google Gemini API documentation.
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';

export interface GeminiLlmOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  thinkingBudget?: number;
}

function truncateExcerpt(text: string, maxLen = 200): string {
  if (!text || typeof text !== 'string') return '';
  let clean = text.replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_KEY]');
  clean = clean.replace(/key=[^&\s"'`]+/gi, 'key=[REDACTED]');
  clean = clean.replace(/\?[^\s"'`]+/g, '?[REDACTED]');
  if (clean.length > maxLen) {
    return clean.slice(0, maxLen) + '... [truncated]';
  }
  return clean;
}

function isThoughtPart(part: any): boolean {
  return Boolean(part && (part.thought || part.thoughtSignature));
}

export class GeminiLlm implements LlmPort {
  public readonly info: { provider: string; model: string };
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn?: typeof fetch;
  public readonly thinkingBudget?: number;

  constructor(options: GeminiLlmOptions) {
    this.apiKey = options.apiKey;
    this.model =
      options.model ||
      process.env.LLM_MODEL ||
      process.env.GEMINI_MODEL ||
      DEFAULT_GEMINI_MODEL;
    this.timeoutMs =
      options.timeoutMs ??
      (process.env.LLM_TIMEOUT_MS
        ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
        : 15000);
    this.fetchFn = options.fetchFn;

    const isThinking =
      this.model.includes('thinking') ||
      this.model.startsWith('gemini-2') ||
      this.model.startsWith('gemini-3');

    this.thinkingBudget =
      options.thinkingBudget !== undefined
        ? options.thinkingBudget
        : process.env.GEMINI_THINKING_BUDGET !== undefined
          ? parseInt(process.env.GEMINI_THINKING_BUDGET, 10)
          : isThinking
            ? 0
            : undefined;

    this.info = {
      provider: 'gemini',
      model: this.model,
    };
  }

  private async postJson(url: string, payload: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const fetchImpl = this.fetchFn || globalThis.fetch;
      const res = await fetchImpl(url, {
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
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: sanitizedSchema,
        ...(this.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: this.thinkingBudget } }
          : {}),
      },
    };

    const data = await this.postJson(endpoint, body);
    const candidate = data?.candidates?.[0];
    const finishReason =
      candidate?.finishReason || data?.promptFeedback?.blockReason || 'UNKNOWN';

    if (finishReason === 'SAFETY' || data?.promptFeedback?.blockReason) {
      const excerpt = truncateExcerpt(JSON.stringify(data), 200);
      console.warn(
        `[gemini] Response blocked by safety: finishReason=${finishReason}. Excerpt: ${excerpt}`,
      );
      throw new LlmMalformedOutputError(
        `Gemini response blocked by safety: finishReason=${finishReason}. Excerpt: ${excerpt}`,
      );
    }

    if (finishReason === 'MAX_TOKENS') {
      const parts = candidate?.content?.parts;
      const rawText = parts?.map((p: any) => p.text || '').join('') || '';
      const excerpt = truncateExcerpt(rawText || JSON.stringify(data), 200);
      console.warn(
        `[gemini] Output truncated: finishReason=MAX_TOKENS. Excerpt: ${excerpt}`,
      );
      throw new LlmMalformedOutputError(
        `Gemini output truncated: finishReason=MAX_TOKENS. Excerpt: ${excerpt}`,
      );
    }

    const parts = candidate?.content?.parts;
    if (!candidate || !parts || parts.length === 0) {
      const excerpt = truncateExcerpt(JSON.stringify(data), 200);
      console.warn(
        `[gemini] Empty candidate or parts: finishReason=${finishReason}. Excerpt: ${excerpt}`,
      );
      throw new LlmMalformedOutputError(
        `Gemini response did not contain candidates[0].content.parts (finishReason=${finishReason})`,
      );
    }

    const nonThoughtParts = parts.filter(
      (p: any) => !isThoughtPart(p) && typeof p.text === 'string',
    );
    const textPart =
      nonThoughtParts.length > 0
        ? nonThoughtParts.map((p: any) => p.text).join('')
        : parts.find((p: any) => typeof p.text === 'string')?.text;

    if (!textPart || textPart.trim().length === 0) {
      const excerpt = truncateExcerpt(JSON.stringify(data), 200);
      console.warn(
        `[gemini] Empty text content: finishReason=${finishReason}. Excerpt: ${excerpt}`,
      );
      throw new LlmMalformedOutputError(
        `Gemini response did not contain text content: finishReason=${finishReason}. Excerpt: ${excerpt}`,
      );
    }

    try {
      return JSON.parse(textPart) as R;
    } catch (parseErr) {
      const excerpt = truncateExcerpt(textPart, 200);
      console.warn(
        `[gemini] Failed to parse JSON: finishReason=${finishReason}, err=${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Excerpt: ${excerpt}`,
      );
      throw new LlmMalformedOutputError(
        `Failed to parse Gemini JSON output (finishReason=${finishReason}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Excerpt: ${excerpt}`,
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
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          ...(this.thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget: this.thinkingBudget } }
            : {}),
        },
      };

      const data = await this.postJson(endpoint, body);
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts;

      if (!parts || parts.length === 0) {
        throw new LlmMalformedOutputError('Gemini returned empty parts');
      }

      let hadFunctionCall = false;

      for (const part of parts) {
        if (isThoughtPart(part)) {
          continue;
        }
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

