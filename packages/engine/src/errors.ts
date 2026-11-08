export type EngineErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_IMPLEMENTED';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

