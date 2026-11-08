import type { LlmPort } from '@settle/shared';
import {
  LlmHttpError,
  LlmMalformedOutputError,
  LlmTimeoutError,
} from './errors.js';

// NOTE: Please confirm current model IDs in the official OpenAI API documentation.
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export interface OpenAiLlmOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OpenAiLlm implements LlmPort {
  public readonly info: { provider: string; model: string };
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiLlmOptions) {
    this.apiKey = options.apiKey;
    this.model =
      options.model ||
      process.env.OPENAI_MODEL ||
      DEFAULT_OPENAI_MODEL;
    this.timeoutMs =
      options.timeoutMs ??
      (process.env.LLM_TIMEOUT_MS
        ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
        : 15000);
    this.fetchFn = options.fetchFn ?? fetch;
    this.info = {
      provider: 'openai',
      model: this.model,
    };
  }

  private async postJson(payload: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

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
          `OpenAI request timed out after ${this.timeoutMs}ms`,
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
    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: a.system },
        { role: 'user', content: a.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_response',
          schema: a.jsonSchema,
        },
      },
    };

    const data = await this.postJson(body);
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;

    if (!content) {
      throw new LlmMalformedOutputError(
        'OpenAI response missing message content',
      );
    }

    try {
      return JSON.parse(content) as R;
    } catch (err) {
      throw new LlmMalformedOutputError(
        `Failed to parse OpenAI JSON output: ${err instanceof Error ? err.message : String(err)}`,
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
    const toolMap = new Map(a.tools.map((t) => [t.name, t]));
    const executedCalls: { name: string; args: unknown; result: unknown }[] = [];

    const openAiTools = a.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.jsonSchema,
      },
    }));

    const conversationMessages: any[] = [];
    if (a.system) {
      conversationMessages.push({ role: 'system', content: a.system });
    }
    for (const msg of a.messages) {
      conversationMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    let finalAnswer = '';
    const max = Math.max(1, a.maxSteps);

    for (let step = 0; step < max; step++) {
      const body = {
        model: this.model,
        temperature: 0,
        messages: conversationMessages,
        tools: openAiTools.length > 0 ? openAiTools : undefined,
      };

      const data = await this.postJson(body);
      const choice = data?.choices?.[0];
      const message = choice?.message;

      if (!message) {
        throw new LlmMalformedOutputError('OpenAI response missing message');
      }

      conversationMessages.push(message);

      if (message.content) {
        finalAnswer = message.content;
      }

      if (
        !message.tool_calls ||
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length === 0
      ) {
        break;
      }

      for (const tc of message.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs: unknown = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          fnArgs = {};
        }

        const tool = toolMap.get(fnName);
        let result: unknown;
        if (tool) {
          result = await tool.run(fnArgs);
        } else {
          result = { error: `Tool ${fnName} not found` };
        }

        executedCalls.push({
          name: fnName,
          args: fnArgs,
          result,
        });

        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      text: finalAnswer,
      toolCalls: executedCalls,
    };
  }
}

