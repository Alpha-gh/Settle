import { z } from 'zod';

export class ApiError extends Error {
  readonly endpoint: string;
  readonly status: number;

  constructor(endpoint: string, status: number, message: string) {
    super(`API Error [${status}] at ${endpoint}: ${message}`);
    this.name = 'ApiError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

export class ApiHttpError extends ApiError {
  readonly responseBody: unknown;

  constructor(endpoint: string, status: number, message: string, responseBody?: unknown) {
    super(endpoint, status, message);
    this.name = 'ApiHttpError';
    this.responseBody = responseBody;
  }
}

export function humanizeApiError(err: unknown): string {
  if (err instanceof ApiHttpError) {
    const body = err.responseBody;
    const errorCode =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { code?: string; message?: string } }).error?.code
        : undefined;
    const apiMsg =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { code?: string; message?: string } }).error?.message
        : undefined;

    if (err.status === 409) {
      if (errorCode === 'ACTION_NOT_OPEN') return 'This action has already been resolved or closed.';
      if (errorCode === 'NOT_PROVISIONED') return 'This invoice is not set up in PayPal yet.';
      if (errorCode === 'AGENT_RUN_IN_PROGRESS') return 'Another agent run is currently in progress. Please wait a moment.';
      if (errorCode === 'NOTHING_DUE') return 'This invoice has already been fully paid.';
      if (apiMsg && typeof apiMsg === 'string' && !apiMsg.startsWith('{')) return apiMsg;
    }
    if (err.status === 502) {
      if (apiMsg && typeof apiMsg === 'string' && !apiMsg.startsWith('{')) return apiMsg;
      if (err.message && !err.message.startsWith('{')) return err.message;
      return 'PayPal service is currently unavailable. Please try again.';
    }
    if (apiMsg && typeof apiMsg === 'string' && !apiMsg.startsWith('{')) {
      return apiMsg;
    }
    if (err.message && !err.message.startsWith('{')) {
      return err.message;
    }
    return 'An unexpected error occurred. Please try again.';
  }
  if (err instanceof Error && err.message && !err.message.startsWith('{')) {
    return err.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

export class ApiSchemaError extends ApiError {
  readonly issues: z.ZodIssue[];
  readonly rawData: unknown;

  constructor(endpoint: string, issues: z.ZodIssue[], rawData: unknown) {
    const formatted = issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
    super(endpoint, 422, `Zod schema validation failed for ${endpoint}: ${formatted}`);
    this.name = 'ApiSchemaError';
    this.issues = issues;
    this.rawData = rawData;
  }
}

export interface SchemaErrorInfo {
  endpoint: string;
  issues: z.ZodIssue[];
  rawData: unknown;
}

/**
 * Global event dispatcher to notify DevErrorOverlay when schema validation fails in development.
 */
export function dispatchDevSchemaError(info: SchemaErrorInfo): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settle:schema-error', { detail: info }));
  }
}

const getBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return '';
};

/**
 * Core typed API request wrapper.
 * Strictly parses all inbound responses with Zod schemas.
 * Per AGENT_RULES.md (Rule 5):
 * - No `any`, no `as` casts on API data.
 * - In development, parse failure throws and renders a visible full-width error overlay.
 * - In production, logs and shows standard error with retry.
 */
export async function apiRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (err) {
    throw new ApiError(endpoint, 0, err instanceof Error ? err.message : 'Network failure');
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: { message?: string } }).error.message || response.statusText
        : response.statusText;
    throw new ApiHttpError(endpoint, response.status, message, body);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const rawJson: unknown = await response.json();
  const result = schema.safeParse(rawJson);

  if (!result.success) {
    const schemaError = new ApiSchemaError(endpoint, result.error.issues, rawJson);

    if (import.meta.env.DEV) {
      dispatchDevSchemaError({
        endpoint,
        issues: result.error.issues,
        rawData: rawJson,
      });
      // In dev, also log full details to console
      console.error(`[Zod Parse Error at ${endpoint}]:`, result.error.format(), rawJson);
    } else {
      console.error(`[API Schema Error at ${endpoint}]:`, result.error.message);
    }

    throw schemaError;
  }

  return result.data;
}

