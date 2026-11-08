export class LlmTimeoutError extends Error {
  constructor(message = 'LLM request timed out') {
    super(message);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`LLM HTTP Error ${status} (${statusText}): ${body}`);
    this.name = 'LlmHttpError';
  }
}

export class LlmMalformedOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmMalformedOutputError';
  }
}

