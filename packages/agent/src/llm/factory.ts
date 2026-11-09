import type { LlmPort } from '@settle/shared';
import { AnthropicLlm } from './anthropicLlm.js';
import { GeminiLlm } from './geminiLlm.js';
import { MockLlm } from './mockLlm.js';
import { OpenAiLlm } from './openAiLlm.js';

export function createLlmFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmPort & { info?: { provider: string; model: string } } {
  const provider = (env.LLM_PROVIDER || 'mock').trim().toLowerCase();
  const explicitModel = env.LLM_MODEL?.trim() || undefined;

  switch (provider) {
    case 'mock':
      return new MockLlm();

    case 'gemini': {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
      }
      return new GeminiLlm({
        apiKey,
        model: explicitModel || env.GEMINI_MODEL?.trim(),
      });
    }

    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
        );
      }
      return new AnthropicLlm({
        apiKey,
        model: explicitModel || env.ANTHROPIC_MODEL?.trim(),
      });
    }

    case 'openai': {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }
      return new OpenAiLlm({
        apiKey,
        model: explicitModel || env.OPENAI_MODEL?.trim(),
      });
    }

    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${provider}". Valid providers: mock, gemini, anthropic, openai.`,
      );
  }
}

