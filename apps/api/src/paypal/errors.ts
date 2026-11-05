export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue?: string;
  description?: string;
}

export class PayPalError extends Error {
  public readonly status: number;
  public readonly paypalName?: string;
  public readonly debug_id?: string;
  public readonly debugId?: string;
  public readonly paypalRequestId?: string;
  public readonly details?: PayPalErrorDetail[];
  public readonly issues?: string[];
  public readonly rawError?: unknown;

  constructor(params: {
    message: string;
    status: number;
    name?: string;
    paypalName?: string;
    debug_id?: string;
    debugId?: string;
    paypalRequestId?: string;
    details?: PayPalErrorDetail[];
    rawError?: unknown;
  }) {
    super(params.message);
    this.name = 'PayPalError';
    this.status = params.status;
    this.paypalName = params.paypalName ?? params.name;
    const resolvedDebugId = params.debug_id ?? params.debugId;
    this.debug_id = resolvedDebugId;
    this.debugId = resolvedDebugId;
    this.paypalRequestId = params.paypalRequestId;
    this.details = params.details;
    this.issues = params.details?.map((d) => d.issue).filter((i): i is string => Boolean(i));
    this.rawError = params.rawError;
  }
}
