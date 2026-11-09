import { describe, expect, it } from 'vitest';
import { createLlmFromEnv } from '../src/llm/factory.js';

describe('createLlmFromEnv factory', () => {
  it('defaults to MockLlm when LLM_PROVIDER is not set or mock', () => {
    const llm = createLlmFromEnv({});
    expect(llm.info?.provider).toBe('mock');
    expect(llm.info?.model).toBe('mock-model');
  });

  it('reads LLM_MODEL and prefers it over default for Gemini', () => {
    const llm = createLlmFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-api-key',
      LLM_MODEL: 'gemini-2.0-flash-exp',
    });
    expect(llm.info?.provider).toBe('gemini');
    expect(llm.info?.model).toBe('gemini-2.0-flash-exp');
  });

  it('keeps hard-coded default (gemini-1.5-flash) when LLM_MODEL and GEMINI_MODEL are empty', () => {
    const llm = createLlmFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-api-key',
    });
    expect(llm.info?.provider).toBe('gemini');
    expect(llm.info?.model).toBe('gemini-1.5-flash');
  });

  it('prefers LLM_MODEL over GEMINI_MODEL when both are provided', () => {
    const llm = createLlmFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-api-key',
      GEMINI_MODEL: 'gemini-1.5-pro',
      LLM_MODEL: 'gemini-2.5-flash',
    });
    expect(llm.info?.model).toBe('gemini-2.5-flash');
  });

  it('falls back to GEMINI_MODEL when LLM_MODEL is empty', () => {
    const llm = createLlmFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-api-key',
      GEMINI_MODEL: 'gemini-1.5-pro',
      LLM_MODEL: '',
    });
    expect(llm.info?.model).toBe('gemini-1.5-pro');
  });

  it('reads LLM_MODEL for anthropic and openai', () => {
    const anthropicLlm = createLlmFromEnv({
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      LLM_MODEL: 'claude-3-7-sonnet',
    });
    expect(anthropicLlm.info?.provider).toBe('anthropic');
    expect(anthropicLlm.info?.model).toBe('claude-3-7-sonnet');

    const openaiLlm = createLlmFromEnv({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-openai-key',
      LLM_MODEL: 'gpt-4o',
    });
    expect(openaiLlm.info?.provider).toBe('openai');
    expect(openaiLlm.info?.model).toBe('gpt-4o');
  });
});

