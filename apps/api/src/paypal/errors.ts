export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue?: string;
  description?: string;
}

export class PayPalError extends Error {
  public readonly status: number;
  public readonly debugId?: string;
  public readonly paypalRequestId?: string;
  public readonly details?: PayPalErrorDetail[];
  public readonly rawError?: unknown;

  constructor(params: {
    message: string;
    status: number;
    debugId?: string;
    paypalRequestId?: string;
    details?: PayPalErrorDetail[];
    rawError?: unknown;
  }) {
    super(params.message);
    this.name = 'PayPalError';
    this.status = params.status;
    this.debugId = params.debugId;
    this.paypalRequestId = params.paypalRequestId;
    this.details = params.details;
    this.rawError = params.rawError;
  }
}

