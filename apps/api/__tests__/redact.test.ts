import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/utils/redact.js';

describe('redactSecrets utility', () => {
  it('redacts URL query strings on endpoints', () => {
    const raw =
      'Request to https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyD1234567890ABCDEF1234567890 failed';
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain('AIzaSyD1234567890ABCDEF1234567890');
    expect(redacted).toContain('?[REDACTED]');
  });

  it('redacts explicit secrets passed as extra arguments', () => {
    const customSecret = 'SUPER_SECRET_TOKEN_999';
    const raw = `Error occurred with secret: ${customSecret} in operation`;
    const redacted = redactSecrets(raw, [customSecret]);
    expect(redacted).not.toContain(customSecret);
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts common LLM API key patterns', () => {
    const geminiKey = 'AIzaSyAaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp';
    const openAiKey = 'sk-proj-1234567890abcdefghijklmnopqrstuv';
    const anthropicKey = 'sk-ant-1234567890abcdefghijklmnopqrstuvwxyz';
    const bearer = 'Bearer ya29.a0AfH6SMBabc12345xyz';

    expect(redactSecrets(`Key was ${geminiKey}`)).not.toContain(geminiKey);
    expect(redactSecrets(`Key was ${openAiKey}`)).not.toContain(openAiKey);
    expect(redactSecrets(`Key was ${anthropicKey}`)).not.toContain(anthropicKey);
    expect(redactSecrets(`Header: ${bearer}`)).toBe('Header: Bearer [REDACTED]');
  });

  it('redacts query parameter tokens in messages', () => {
    const msg = 'Failed call at /v1/chat?api_key=secret_12345&foo=bar';
    const redacted = redactSecrets(msg);
    expect(redacted).not.toContain('secret_12345');
    expect(redacted).toContain('api_key=[REDACTED]');
  });

  it('leaves clean strings unchanged', () => {
    const clean = 'All models passed verification successfully.';
    expect(redactSecrets(clean)).toBe(clean);
  });
});

