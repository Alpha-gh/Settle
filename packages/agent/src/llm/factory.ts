import type { LlmPort } from '@settle/shared';
import { AnthropicLlm } from './anthropicLlm.js';
import { GeminiLlm } from './geminiLlm.js';
import { MockLlm } from './mockLlm.js';
import { OpenAiLlm } from './openAiLlm.js';

export function createLlmFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmPort & { info?: { provider: string; model: string } } {
  const provider = (env.LLM_PROVIDER || 'mock').trim().toLowerCase();

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
        model: env.GEMINI_MODEL,
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
        model: env.ANTHROPIC_MODEL,
      });
    }

    case 'openai': {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }
      return new OpenAiLlm({
        apiKey,
        model: env.OPENAI_MODEL,
      });
    }

    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${provider}". Valid providers: mock, gemini, anthropic, openai.`,
      );
  }
}

