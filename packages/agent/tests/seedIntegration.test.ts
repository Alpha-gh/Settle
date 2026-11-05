import { loadSeedSnapshot } from '@settle/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { DeterministicIdGen } from '../src/ids.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';

describe('seedIntegration', () => {
  const origDemoToday = process.env['DEMO_TODAY'];

  beforeEach(() => {
    process.env['DEMO_TODAY'] = '2026-11-05';
  });

  afterEach(() => {
    if (origDemoToday === undefined) {
      delete process.env['DEMO_TODAY'];
    } else {
      process.env['DEMO_TODAY'] = origDemoToday;
    }
  });

  it('runs runCycle on real seed snapshot with expected invariants', async () => {
    const snapshot = loadSeedSnapshot();
    const clock = new FixedClock('2026-11-05T10:00:00Z');
    const engine = new FakeEngine({
      closesGapMap: {
        inv_001: true,
        inv_002: true,
      },
    });
    const llm = new MockLlm({ mode: 'good' });
    const idGen = new DeterministicIdGen();

    const agent = createAgent({
      engine,
      llm,
      clock,
      idGen,
    });

    const result = await agent.runCycle(snapshot);

    const overdueInvoices = snapshot.invoices.filter(
      (inv) =>
        inv.dueDate < snapshot.business.asOf &&
        (inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID') &&
        inv.amount - inv.amountPaid > 0,
    );

    // Every overdue invoice appears exactly once in actions or skipped
    const handledIds = new Set<string>();
    for (const act of result.actions) {
      expect(handledIds.has(act.invoiceId)).toBe(false);
      handledIds.add(act.invoiceId);
    }
    for (const skip of result.skipped) {
      expect(handledIds.has(skip.invoiceId)).toBe(false);
      handledIds.add(skip.invoiceId);
    }

    expect(handledIds.size).toBe(overdueInvoices.length);
    for (const inv of overdueInvoices) {
      expect(handledIds.has(inv.id)).toBe(true);
    }

    // Ghost payer invoice is ESCALATE
    const ghostPayer = snapshot.payers.find((p) => p.persona === 'ghost');
    expect(ghostPayer).toBeDefined();
    const ghostInvoice = snapshot.invoices.find(
      (inv) => inv.payerId === ghostPayer!.id && overdueInvoices.includes(inv),
    );
    expect(ghostInvoice).toBeDefined();

    const ghostAction = result.actions.find(
      (act) => act.invoiceId === ghostInvoice!.id,
    );
    expect(ghostAction).toBeDefined();
    expect(ghostAction!.type).toBe('ESCALATE');

    // Every action's status is one of APPROVED, AWAITING_APPROVAL, BLOCKED
    for (const action of result.actions) {
      expect(['APPROVED', 'AWAITING_APPROVAL', 'BLOCKED']).toContain(
        action.status,
      );
    }
  });
});

