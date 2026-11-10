import type { LlmPort } from '@settle/shared';
import {
  LlmHttpError,
  LlmMalformedOutputError,
  LlmTimeoutError,
} from './errors.js';

// NOTE: Please confirm current model IDs in the official Anthropic API documentation.
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

export interface AnthropicLlmOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class AnthropicLlm implements LlmPort {
  public readonly info: { provider: string; model: string };
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicLlmOptions) {
    this.apiKey = options.apiKey;
    this.model =
      options.model ||
      process.env.ANTHROPIC_MODEL ||
      DEFAULT_ANTHROPIC_MODEL;
    this.timeoutMs =
      options.timeoutMs ??
      (process.env.LLM_CALL_TIMEOUT_SECONDS
        ? Math.round(parseFloat(process.env.LLM_CALL_TIMEOUT_SECONDS) * 1000)
        : process.env.LLM_TIMEOUT_MS
          ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
          : 12000);
    this.fetchFn = options.fetchFn ?? fetch;
    this.info = {
      provider: 'anthropic',
      model: this.model,
    };
  }

  private async postJson(payload: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
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
          `Anthropic request timed out after ${this.timeoutMs}ms`,
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
    const toolName = 'structured_output';
    const body = {
      model: this.model,
      max_tokens: 1024,
      temperature: 0,
      system: a.system,
      messages: [{ role: 'user', content: a.user }],
      tools: [
        {
          name: toolName,
          description: 'Emit the requested structured output.',
          input_schema: a.jsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
    };

    const data = await this.postJson(body);
    const content = data?.content;

    if (!Array.isArray(content)) {
      throw new LlmMalformedOutputError(
        'Anthropic response missing content array',
      );
    }

    const toolUse = content.find(
      (c) => c.type === 'tool_use' && c.name === toolName,
    );

    if (!toolUse || !toolUse.input) {
      throw new LlmMalformedOutputError(
        'Anthropic response missing required tool_use block',
      );
    }

    return toolUse.input as R;
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

    const anthropicTools = a.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));

    const conversationMessages: any[] = a.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let finalAnswer = '';
    const max = Math.max(1, a.maxSteps);

    for (let step = 0; step < max; step++) {
      const body = {
        model: this.model,
        max_tokens: 1024,
        temperature: 0,
        system: a.system,
        messages: conversationMessages,
        tools: anthropicTools,
      };

      const data = await this.postJson(body);
      const content = data?.content;

      if (!Array.isArray(content)) {
        throw new LlmMalformedOutputError(
          'Anthropic response missing content array',
        );
      }

      conversationMessages.push({
        role: 'assistant',
        content,
      });

      const textParts = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text);
      if (textParts.length > 0) {
        finalAnswer = textParts.join('\n');
      }

      const toolUses = content.filter((c) => c.type === 'tool_use');

      if (toolUses.length === 0 || data.stop_reason !== 'tool_use') {
        break;
      }

      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const tool = toolMap.get(tu.name);
        let result: unknown;
        if (tool) {
          result = await tool.run(tu.input);
        } else {
          result = { error: `Tool ${tu.name} not found` };
        }

        executedCalls.push({
          name: tu.name,
          args: tu.input,
          result,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }

      conversationMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    return {
      text: finalAnswer,
      toolCalls: executedCalls,
    };
  }
}

