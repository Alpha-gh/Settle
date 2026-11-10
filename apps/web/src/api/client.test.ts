import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { apiRequest, ApiSchemaError, ApiHttpError } from './client';

describe('apiRequest and schema validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses valid response with schema', async () => {
    const testSchema = z.object({
      id: z.string(),
      count: z.number().int(),
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'test_1', count: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await apiRequest('/api/test', testSchema);
    expect(result).toEqual({ id: 'test_1', count: 42 });
  });

  it('throws ApiHttpError on non-200 HTTP response', async () => {
    const testSchema = z.object({ id: z.string() });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiRequest('/api/missing', testSchema)).rejects.toThrow(ApiHttpError);
  });

  it('throws ApiSchemaError and dispatches event when zod parsing fails', async () => {
    const testSchema = z.object({
      id: z.string(),
      amount: z.number().int(),
    });

    const eventSpy = vi.fn();
    window.addEventListener('settle:schema-error', eventSpy);

    // Corrupt response: amount is string instead of number
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'inv_1', amount: 'not_a_number' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiRequest('/api/snapshot', testSchema)).rejects.toThrow(ApiSchemaError);

    expect(eventSpy).toHaveBeenCalled();
    const event = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.endpoint).toBe('/api/snapshot');
    expect(event.detail.issues[0].path).toEqual(['amount']);

    window.removeEventListener('settle:schema-error', eventSpy);
  });

  it('uses relative URL when VITE_API_BASE is unset and defaults POST body to "{}" with Content-Type: application/json', async () => {
    const testSchema = z.object({ ok: z.boolean() });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await apiRequest('/api/agent/run', testSchema, { method: 'POST' });
    expect(res).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/agent/run');
    expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });
});

