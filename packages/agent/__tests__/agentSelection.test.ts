import { describe, expect, it, vi } from 'vitest';
import type {
  Invoice,
  Payer,
  ScenarioChange,
  ScenarioComparison,
} from '@settle/shared';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { deterministicChoice, templatedReason } from '../src/fallback.js';
import { buildAllowedSet, checkGrounding } from '../src/grounding.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import {
  filterEligibleCandidates,
  type Candidate,
} from '../src/options.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

describe('Agent Candidate Eligibility & Owner-Facing Selection', () => {
  const clock = new FixedClock('2026-11-05T10:00:00Z');

  const basePayer: Payer = {
    id: 'pay_001',
    name: 'Acme Studio',
    email: 'acme@example.com',
    persona: 'slow',
    avgDaysLate: 10,
    latenessRisk: 0.2,
  };

  const baseInvoice: Invoice = {
    id: 'inv_001',
    payerId: 'pay_001',
    number: 'INV-1001',
    description: 'Design services',
    amount: 350000,
    amountPaid: 0,
    issueDate: '2026-10-15',
    dueDate: '2026-10-31',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
  };

  describe('1. filterEligibleCandidates', () => {
    it('(a) baseline has no breach -> eligible = options with lowest cashCost (normally REMIND, ties kept)', () => {
      const sims: ScenarioComparison[] = [
        {
          change: { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 0,
          shortfallDelta: 0,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-05', amount: 800000 },
            firstBreachDate: null, // No breach
            shortfall: 0,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-05', amount: 800000 },
            firstBreachDate: null,
            shortfall: 0,
          },
        },
        {
          change: { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-11-08' },
          cashCost: 7000,
          lowestDelta: 343000,
          shortfallDelta: 0,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-05', amount: 800000 },
            firstBreachDate: null,
            shortfall: 0,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-05', amount: 1143000 },
            firstBreachDate: null,
            shortfall: 0,
          },
        },
      ];

      const { eligible, situation } = filterEligibleCandidates(sims, baseInvoice, basePayer);
      expect(situation).toBe('gap already closed by earlier choices');
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.change.type).toBe('REMIND');
      expect(eligible[0]!.id).toBe('opt_1');
    });

    it('(b) baseline has breach and options close gap -> eligible = options that close gap with lowest cashCost', () => {
      const sims: ScenarioComparison[] = [
        {
          change: { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 0,
          shortfallDelta: 0,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -200000 },
            firstBreachDate: '2026-11-09',
            shortfall: 200000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: -200000 },
            firstBreachDate: '2026-11-09',
            shortfall: 200000,
          },
        },
        {
          change: { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-11-08' },
          cashCost: 7000,
          lowestDelta: 343000,
          shortfallDelta: 200000,
          closesGap: true,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -200000 },
            firstBreachDate: '2026-11-09',
            shortfall: 200000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: 143000 },
            firstBreachDate: null,
            shortfall: 0,
          },
        },
        {
          change: { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 3, newExpectedDate: '2026-11-08' },
          cashCost: 10500,
          lowestDelta: 339500,
          shortfallDelta: 200000,
          closesGap: true,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -200000 },
            firstBreachDate: '2026-11-09',
            shortfall: 200000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: 139500 },
            firstBreachDate: null,
            shortfall: 0,
          },
        },
      ];

      const { eligible, situation } = filterEligibleCandidates(sims, baseInvoice, basePayer);
      expect(situation).toBe('this option closes the gap');
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.change.type).toBe('OFFER_DISCOUNT');
      expect((eligible[0]!.change as any).discountPct).toBe(2);
      expect(eligible[0]!.id).toBe('opt_1');
    });

    it('(c) baseline has breach and no option closes gap -> eligible = options with largest lowestDelta, ties broken by lowest cashCost', () => {
      const sims: ScenarioComparison[] = [
        {
          change: { type: 'REMIND', invoiceId: 'inv_001', newExpectedDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 50000,
          shortfallDelta: 50000,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -500000 },
            firstBreachDate: '2026-11-09',
            shortfall: 500000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: -450000 },
            firstBreachDate: '2026-11-09',
            shortfall: 450000,
          },
        },
        {
          change: { type: 'OFFER_INSTALMENTS', invoiceId: 'inv_001', count: 3, spacingDays: 14, firstDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 250000,
          shortfallDelta: 250000,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -500000 },
            firstBreachDate: '2026-11-09',
            shortfall: 500000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: -250000 },
            firstBreachDate: '2026-11-09',
            shortfall: 250000,
          },
        },
        {
          change: { type: 'OFFER_DISCOUNT', invoiceId: 'inv_001', discountPct: 2, newExpectedDate: '2026-11-08' },
          cashCost: 7000,
          lowestDelta: 250000,
          shortfallDelta: 250000,
          closesGap: false,
          assumptions: [],
          baseline: {
            days: [],
            lowest: { date: '2026-11-09', amount: -500000 },
            firstBreachDate: '2026-11-09',
            shortfall: 500000,
          },
          scenario: {
            days: [],
            lowest: { date: '2026-11-09', amount: -250000 },
            firstBreachDate: '2026-11-09',
            shortfall: 250000,
          },
        },
      ];

      const { eligible, situation } = filterEligibleCandidates(sims, baseInvoice, basePayer);
      expect(situation).toBe('nothing closes the gap');
      // Both instalments and discount have max lowestDelta 250000; instalments has lower cashCost (0 < 7000)
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.change.type).toBe('OFFER_INSTALMENTS');
      expect(eligible[0]!.cashCost).toBe(0);
    });
  });

  describe('2. Multi-discount prevention on seed simulation', () => {
    it('inv_001 gets the cheapest gap-closing discount, and subsequent invoices get REMIND', async () => {
      const baseSnapshot = buildSnapshot();
      // Ensure we have two slow payers with overdue invoices
      const slowPayer = baseSnapshot.payers.find((p) => p.persona === 'slow')!;
      const inv1 = baseSnapshot.invoices.find((i) => i.id === 'inv_001')!;
      const inv2 = baseSnapshot.invoices.find((i) => i.id === 'inv_002')!;

      const snapshot = buildSnapshot({
        payers: baseSnapshot.payers,
        invoices: [inv1, inv2],
      });

      // Simulation: inv_001 closes gap with discount; inv_002 has no breach because working baseline is resolved
      let inv1Processed = false;
      const engine = new FakeEngine({
        closesGapMap: {
          'OFFER_DISCOUNT:inv_001': true,
        },
      });

      // Override forecast to simulate that once inv1 discount is folded, working baseline has no breach
      const originalSimulate = engine.simulate.bind(engine);
      engine.simulate = (input, change) => {
        const sim = originalSimulate(input, change);
        if (inv1Processed) {
          // Working baseline is now resolved: no breach
          sim.baseline.firstBreachDate = null;
          sim.baseline.shortfall = 0;
          sim.closesGap = false;
        }
        return sim;
      };

      const originalGenerate = engine.generateOptions.bind(engine);
      engine.generateOptions = (input, invoice, payer, policy) => {
        if (invoice.id === 'inv_002') {
          inv1Processed = true;
        }
        return originalGenerate(input, invoice, payer, policy);
      };

      const llm = new MockLlm({ mode: 'good' });
      const agent = createAgent({ engine, llm, clock });
      const result = await agent.runCycle(snapshot);

      expect(result.actions).toHaveLength(2);
      const act1 = result.actions.find((a) => a.invoiceId === 'inv_001')!;
      const act2 = result.actions.find((a) => a.invoiceId === 'inv_002')!;

      // inv_001 receives the gap-closing discount
      expect(act1.type).toBe('OFFER_DISCOUNT');
      // inv_002 receives REMIND because the breach was already closed
      expect(act2.type).toBe('REMIND');

      // Check owner-facing reasons: no internal IDs or forbidden words
      for (const act of [act1, act2]) {
        expect(act.reason.length).toBeLessThanOrEqual(280); // with provenance suffix
        const cleanReason = act.reason.replace(/\s*\[via.*\]$/, '');
        expect(cleanReason.length).toBeLessThanOrEqual(240);
        expect(cleanReason).not.toMatch(/\bopt_\w+/i);
        expect(cleanReason).not.toMatch(/\bcents?\b/i);
        expect(cleanReason).not.toMatch(/\blowestDelta\b/i);
        expect(cleanReason).not.toMatch(/\bcashCost\b/i);
        expect(cleanReason).not.toMatch(/\bclosesGap\b/i);
        expect(cleanReason).not.toMatch(/selection\s+guidance/i);
      }
    });
  });

  describe('3. Rejection of ineligible IDs', () => {
    it('rejects option ID not in eligible list and falls back to deterministic choice', async () => {
      const snapshot = buildSnapshot();
      const slowPayer = snapshot.payers.find((p) => p.persona === 'slow')!;
      const slowInv = snapshot.invoices.find((i) => i.id === 'inv_001')!;

      const llm = new MockLlm({ mode: 'unknownId' });
      const engine = new FakeEngine();
      const agent = createAgent({ engine, llm, clock });

      const result = await agent.runCycle(
        buildSnapshot({ payers: [slowPayer], invoices: [slowInv] }),
      );

      const action = result.actions[0]!;
      expect(action.reason).toContain('path=fallback');
      const metrics = agent.getLastRunMetrics();
      expect(metrics.fallbacks).toBe(1);
    });
  });

  describe('4. Rejection of forbidden terms and ungrounded numbers in reasons', () => {
    it('checkGrounding rejects reasons containing opt_1, cents, lowestDelta, cashCost, closesGap', () => {
      const allowed = new Set<string>(['cents:350000', 'int:3500', 'date:2026-10-31']);

      const testCases = [
        'opt_1 closes the gap with minimal cost.',
        'Total fee is 7000 cents for prompt recovery.',
        'Improves balance with lowestDelta of 5000.',
        'Selected with cashCost of $70.00.',
        'Option closesGap according to calculations.',
        'Per selection guidance, choosing option now.',
        'Unverified balance of $999,999.00 due today.',
      ];

      for (const reason of testCases) {
        const check = checkGrounding(reason, allowed);
        expect(check.ok).toBe(false);
        expect(check.offenders.length).toBeGreaterThan(0);
      }
    });
  });

  describe('5. Owner-facing templated reasons pass grounding for all action types', () => {
    it('generates grounded, plain English reasons <= 240 chars for all actions', () => {
      const invoice = baseInvoice;
      const payer = basePayer;

      const candidates: Candidate[] = [
        {
          id: 'opt_1',
          change: { type: 'REMIND', invoiceId: invoice.id, newExpectedDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 350000,
          shortfallDelta: 0,
          closesGap: false,
          assumptions: [],
          baselineFirstBreachDate: null,
          invoiceNumber: invoice.number,
          dueDate: invoice.dueDate,
          remainingAmount: 350000,
          payerName: payer.name,
          payerPersona: payer.persona,
        },
        {
          id: 'opt_2',
          change: { type: 'OFFER_DISCOUNT', invoiceId: invoice.id, discountPct: 2, newExpectedDate: '2026-11-08' },
          cashCost: 7000,
          lowestDelta: 343000,
          shortfallDelta: 0,
          closesGap: true,
          assumptions: [],
          baselineFirstBreachDate: null,
          invoiceNumber: invoice.number,
          dueDate: invoice.dueDate,
          remainingAmount: 350000,
          payerName: payer.name,
          payerPersona: payer.persona,
        },
        {
          id: 'opt_3',
          change: { type: 'OFFER_INSTALMENTS', invoiceId: invoice.id, count: 3, spacingDays: 14, firstDate: '2026-11-08' },
          cashCost: 0,
          lowestDelta: 350000,
          shortfallDelta: 0,
          closesGap: true,
          assumptions: [],
          baselineFirstBreachDate: null,
          invoiceNumber: invoice.number,
          dueDate: invoice.dueDate,
          remainingAmount: 350000,
          payerName: payer.name,
          payerPersona: payer.persona,
        },
        {
          id: 'escalate',
          change: { type: 'ESCALATE' as any, invoiceId: invoice.id } as unknown as ScenarioChange,
          cashCost: 0,
          lowestDelta: 0,
          shortfallDelta: 0,
          closesGap: false,
          assumptions: [],
          baselineFirstBreachDate: null,
          invoiceNumber: invoice.number,
          dueDate: invoice.dueDate,
          remainingAmount: 350000,
          payerName: payer.name,
          payerPersona: payer.persona,
        },
      ];

      for (const cand of candidates) {
        const reason = templatedReason(cand, invoice);

        // Plain English, <= 240 chars
        expect(reason.length).toBeLessThanOrEqual(240);
        expect(reason).toContain(invoice.number);
        expect(reason).toContain(payer.name);

        // Never contain forbidden words
        expect(reason).not.toMatch(/\bopt_\w+/i);
        expect(reason).not.toMatch(/\bcents?\b/i);
        expect(reason).not.toMatch(/\blowestDelta\b/i);
        expect(reason).not.toMatch(/\bcashCost\b/i);
        expect(reason).not.toMatch(/\bclosesGap\b/i);
        expect(reason).not.toMatch(/selection\s+guidance/i);

        // Passes grounding
        const allowed = buildAllowedSet({
          invoice,
          payer,
          change: cand.change,
          cashCost: cand.cashCost,
          lowestDelta: cand.lowestDelta,
          shortfallDelta: cand.shortfallDelta,
          asOf: '2026-11-05',
        });
        const groundCheck = checkGrounding(reason, allowed);
        expect(groundCheck.ok).toBe(true);
      }
    });
  });

  describe('6. MockLlm runs cleanly without API key', () => {
    it('completes cycle cleanly with MockLlm when no key configured', async () => {
      const snapshot = buildSnapshot();
      const llm = new MockLlm();
      const engine = new FakeEngine();
      const agent = createAgent({ engine, llm, clock });

      const result = await agent.runCycle(snapshot);
      expect(result.runId).toBeDefined();
      expect(result.actions.length).toBeGreaterThan(0);
    });
  });
});
