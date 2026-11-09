/**
 * Redacts API keys, credentials, tokens, and URL query strings from strings and error messages.
 */
export function redactSecrets(
  text: string,
  extraSecrets: (string | undefined | null)[] = [],
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let redacted = text;

  // 1. Redact known environment secrets if present
  const known = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.PAYPAL_CLIENT_SECRET,
    ...extraSecrets,
  ];

  for (const s of known) {
    if (s && s.trim().length >= 4) {
      redacted = redacted.split(s.trim()).join('[REDACTED]');
    }
  }

  // 2. Redact URL query strings in URLs: https://domain/path?key=foo -> https://domain/path?[REDACTED]
  redacted = redacted.replace(
    /(https?:\/\/[^\s"'`?]+)\?[^\s"'`:]*([:]?)/gi,
    '$1?[REDACTED]$2',
  );

  // 3. Redact standalone query parameters (e.g. ?key=... or &api_key=...)
  redacted = redacted.replace(
    /([?&](?:key|apiKey|api_key|token|access_token|secret)=)[^&\s"'`:]+/gi,
    '$1[REDACTED]',
  );

  // 4. Redact specific provider key patterns
  redacted = redacted.replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_GEMINI_KEY]');
  redacted = redacted.replace(
    /sk-(?:proj-)?[A-Za-z0-9-_]{20,}/g,
    '[REDACTED_OPENAI_KEY]',
  );
  redacted = redacted.replace(
    /sk-ant-[A-Za-z0-9-_]{20,}/g,
    '[REDACTED_ANTHROPIC_KEY]',
  );

  // 5. Redact Authorization Bearer headers
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');

  return redacted;
}
