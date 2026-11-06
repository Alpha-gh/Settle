import { describe, it, expect, vi } from 'vitest';
import { mockState } from './state';
import { snapshotSchema } from '../api/schemas';
import { apiRequest, ApiSchemaError } from '../api/client';

describe('Deliberate Corruption Integration Check', () => {
  it('fetch(/api/snapshot) returns schema-valid data initially', async () => {
    mockState.reset();
    const data = mockState.getSnapshot();
    const parsed = snapshotSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('deliberately corrupting a fixture field causes schema validation to throw naming endpoint and zod issues, and reverts cleanly', async () => {
    mockState.reset();

    // Setup event listener for dev error overlay
    const eventSpy = vi.fn();
    window.addEventListener('settle:schema-error', eventSpy);

    // 1. Deliberately corrupt startingBalance to an invalid string type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockState.business as any).startingBalance = 'invalid_corrupted_cents';

    // Mock global fetch to return the corrupted snapshot from mockState
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(mockState.getSnapshot()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // 2. apiRequest must fail schema validation and throw ApiSchemaError
    let thrownError: ApiSchemaError | null = null;
    try {
      await apiRequest('/api/snapshot', snapshotSchema);
    } catch (err) {
      if (err instanceof ApiSchemaError) {
        thrownError = err;
      }
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.endpoint).toBe('/api/snapshot');
    expect(thrownError?.issues.some((issue) => issue.path.includes('startingBalance'))).toBe(true);

    // 3. Confirm dev error overlay event was dispatched naming the endpoint
    expect(eventSpy).toHaveBeenCalled();
    const dispatchedEvent = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(dispatchedEvent.detail.endpoint).toBe('/api/snapshot');
    expect(dispatchedEvent.detail.issues[0].path).toContain('startingBalance');

    // 4. Revert corruption and confirm clean state
    mockState.reset();
    fetchSpy.mockRestore();
    window.removeEventListener('settle:schema-error', eventSpy);

    const revertedData = mockState.getSnapshot();
    const cleanParsed = snapshotSchema.safeParse(revertedData);
    expect(cleanParsed.success).toBe(true);
    expect(typeof cleanParsed.data?.business.startingBalance).toBe('number');
  });
});

