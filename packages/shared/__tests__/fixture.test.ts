import { describe, it, expect } from 'vitest';
import { loadSeedSnapshot } from '../src/index.js';

describe('loadSeedSnapshot', () => {
  it('loads the demo seed snapshot', () => {
    const snapshot = loadSeedSnapshot();
    expect(snapshot.business.name).toBe('Maya Studio');
    expect(snapshot.business.startingBalance).toBe(980_000);
    expect(snapshot.business.reserveThreshold).toBe(500_000);
    expect(snapshot.payers).toHaveLength(6);
    expect(snapshot.invoices).toHaveLength(14);
    expect(snapshot.obligations).toHaveLength(3);
    expect(snapshot.policy.maxDiscountPct).toBe(10);
  });
});
