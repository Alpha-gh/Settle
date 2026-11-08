import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@settle/shared';
import { kpis } from '../src/kpis.js';
import { EngineError } from '../src/errors.js';
import { seedSnapshot } from '../test-support/seedScenario.js';
import { assertNoNaN, deepFreeze } from './helpers.js';

describe('kpis unit tests', () => {
  it('throws EngineError INVALID_INPUT for malformed snapshot or missing fields', () => {
    expect(() => kpis(null as any)).toThrowError(EngineError);
    expect(() => kpis({} as any)).toThrowError(EngineError);
    expect(() => kpis({ business: null, invoices: [], payers: [], obligations: [] } as any)).toThrowError(EngineError);
    expect(() => kpis({ business: seedSnapshot.business, invoices: 'not-array', payers: [], obligations: [] } as any)).toThrowError(EngineError);
    expect(() => kpis({ business: seedSnapshot.business, invoices: [], payers: 'not-array', obligations: [] } as any)).toThrowError(EngineError);
    expect(() => kpis({ business: seedSnapshot.business, invoices: [], payers: [], obligations: 'not-array' } as any)).toThrowError(EngineError);
  });

  it('tie breaks nextObligation using lowest id lexicographically', () => {
    const snap: Snapshot = {
      business: seedSnapshot.business,
      payers: seedSnapshot.payers,
      invoices: [],
      obligations: [
        { id: 'obl_Z', label: 'Z', kind: 'other', amount: 10_000, dueDate: '2026-11-05' },
        { id: 'obl_A', label: 'A', kind: 'other', amount: 20_000, dueDate: '2026-11-05' },
      ],
      policy: seedSnapshot.policy,
    };

    const res = kpis(snap);
    expect(res.nextObligation?.id).toBe('obl_A');
  });

  it('throws EngineError INVALID_INPUT for null invoice or obligation entries', () => {
    const snapInvNull: Snapshot = {
      business: seedSnapshot.business,
      payers: seedSnapshot.payers,
      invoices: [null as any],
      obligations: [],
      policy: seedSnapshot.policy,
    };
    expect(() => kpis(snapInvNull)).toThrowError(EngineError);

    const snapOblNull: Snapshot = {
      business: seedSnapshot.business,
      payers: seedSnapshot.payers,
      invoices: [],
      obligations: [null as any],
      policy: seedSnapshot.policy,
    };
    expect(() => kpis(snapOblNull)).toThrowError(EngineError);
  });

  it('is deterministic and pure across multiple runs', () => {
    const snap = deepFreeze({ ...seedSnapshot });
    const run1 = kpis(snap);
    const run2 = kpis(snap);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
