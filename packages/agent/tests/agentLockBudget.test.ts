import type { LlmPort } from '@settle/shared';
import { describe, expect, it } from 'vitest';
import { SettleAgent, createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { LlmHttpError } from '../src/llm/errors.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

describe('SettleAgent run budget, timeout, call cap, and 429 rate-limit fallback', () => {
  it('enforces runMaxSeconds budget and finishes remaining invoices with rules', async () => {
    const base = buildSnapshot();
    const slowPayerInvoices = base.invoices.slice(0, 4);
    const snapshot = buildSnapshot({ invoices: slowPayerInvoices });

    const baseLlm = new MockLlm({ mode: 'good' });
    let callCount = 0;
    const slowLlm: LlmPort = {
      async generateStructured(args) {
        callCount += 1;
        await new Promise((r) => setTimeout(r, 120));
        return baseLlm.generateStructured(args);
      },
      async runWithTools(args) {
        return baseLlm.runWithTools(args);
      },
    };

    const agent = new SettleAgent({
      engine: new FakeEngine(),
      llm: slowLlm,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
      runMaxSeconds: 0.2,
      llmCallTimeoutSeconds: 0.2,
    });

    const start = performance.now();
    const result = await agent.runCycle(snapshot);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(800);
    expect(result.actions).toHaveLength(4);
    expect(callCount).toBeLessThan(4);
    expect(result.actions.some((a) => a.reason.includes('path=rules'))).toBe(true);
  });

  it('aborts hung LLM calls cleanly via llmCallTimeoutSeconds and falls back', async () => {
    const base = buildSnapshot();
    const slowInvoice = base.invoices.find((i) => i.id === 'inv_001')!;
    const snapshot = buildSnapshot({ invoices: [slowInvoice] });

    const hangingLlm: LlmPort = {
      generateStructured() {
        return new Promise(() => {
          // Never resolves
        });
      },
      runWithTools() {
        return new Promise(() => {
          // Never resolves
        });
      },
    };

    const agent = createAgent({
      engine: new FakeEngine(),
      llm: hangingLlm,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
      runMaxSeconds: 2,
      llmCallTimeoutSeconds: 0.08,
    });

    const start = performance.now();
    const result = await agent.runCycle(snapshot);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(600);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.reason).toMatch(/path=fallback|path=rules/);
  });

  it('skips LLM for single-eligible non-first-discount decisions and enforces maxLlmCallsPerRun', async () => {
    const base = buildSnapshot();
    const reliablePayer = base.payers.find((p) => p.persona === 'reliable')!;
    const reliableInvoices = base.invoices
      .slice(0, 3)
      .map((inv) => ({ ...inv, payerId: reliablePayer.id }));
    const singleEligibleSnapshot = buildSnapshot({
      payers: [reliablePayer],
      invoices: reliableInvoices,
    });

    // Case A: skipSingleEligibleDecision skips single-eligible REMIND decisions (0 LLM calls vs >0 without skip)
    const baseLlm = new MockLlm({ mode: 'good' });
    let noSkipCalls = 0;
    const noSkipSpy: LlmPort = {
      async generateStructured(args) {
        noSkipCalls += 1;
        return baseLlm.generateStructured(args);
      },
      async runWithTools(args) {
        return baseLlm.runWithTools(args);
      },
    };
    const noSkipAgent = new SettleAgent({
      engine: new FakeEngine(),
      llm: noSkipSpy,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
      skipSingleEligibleDecision: false,
    });
    await noSkipAgent.runCycle(singleEligibleSnapshot);
    expect(noSkipCalls).toBeGreaterThan(0);

    let singleSkipCalls = 0;
    const spyLlm: LlmPort = {
      async generateStructured(args) {
        singleSkipCalls += 1;
        return baseLlm.generateStructured(args);
      },
      async runWithTools(args) {
        return baseLlm.runWithTools(args);
      },
    };

    const skipAgent = new SettleAgent({
      engine: new FakeEngine(),
      llm: spyLlm,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
      skipSingleEligibleDecision: true,
    });

    const skipRes = await skipAgent.runCycle(singleEligibleSnapshot);
    expect(skipRes.actions).toHaveLength(3);
    expect(singleSkipCalls).toBe(0);
    expect(skipRes.actions.every((a) => a.reason.includes('path=rules'))).toBe(true);

    // Case B: maxLlmCallsPerRun caps total LLM calls when multiple gap-closing options exist
    const snapshot = buildSnapshot();
    const nonGhostInvoices = base.invoices.filter((inv) => {
      const p = base.payers.find((x) => x.id === inv.payerId);
      return p && p.persona !== 'ghost';
    });
    const gapCloseMap: Record<string, boolean> = {};
    for (const inv of nonGhostInvoices) {
      gapCloseMap[`OFFER_DISCOUNT:${inv.id}`] = true;
      gapCloseMap[`OFFER_INSTALMENTS:${inv.id}`] = true;
    }

    let cappedCalls = 0;
    const cappedLlm: LlmPort = {
      async generateStructured(args) {
        cappedCalls += 1;
        return baseLlm.generateStructured(args);
      },
      async runWithTools(args) {
        return baseLlm.runWithTools(args);
      },
    };

    const cappedAgent = new SettleAgent({
      engine: new FakeEngine({ closesGapMap: gapCloseMap }),
      llm: cappedLlm,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
      skipSingleEligibleDecision: true,
      maxLlmCallsPerRun: 2,
    });

    const cappedRes = await cappedAgent.runCycle(snapshot);
    expect(cappedRes.actions.length).toBeGreaterThan(2);
    expect(cappedCalls).toBeLessThanOrEqual(2);
    expect(cappedAgent.getLastRunMetrics().llmCalls).toBeLessThanOrEqual(2);
    expect(cappedRes.actions.some((a) => a.reason.includes('path=rules'))).toBe(true);
  });

  it('falls back immediately on HTTP 429 rate-limit without retrying or calling LLM for remaining invoices', async () => {
    const base = buildSnapshot();
    const nonGhostInvoices = base.invoices
      .filter((inv) => {
        const p = base.payers.find((x) => x.id === inv.payerId);
        return p && p.persona !== 'ghost';
      })
      .slice(0, 3);
    const snapshot = buildSnapshot({ invoices: nonGhostInvoices });

    let callCount = 0;
    const rateLimitedLlm: LlmPort & { info: { provider: string; model: string } } = {
      info: { provider: 'gemini', model: 'gemini-2.5-flash' },
      async generateStructured() {
        callCount += 1;
        throw new LlmHttpError(
          429,
          'Too Many Requests',
          '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
        );
      },
      async runWithTools() {
        throw new LlmHttpError(429, 'Too Many Requests', 'RESOURCE_EXHAUSTED');
      },
    };

    const agent = new SettleAgent({
      engine: new FakeEngine(),
      llm: rateLimitedLlm,
      clock: new FixedClock('2026-11-05T12:00:00Z'),
    });

    const start = performance.now();
    const result = await agent.runCycle(snapshot);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(200);
    expect(callCount).toBe(1);
    expect(result.actions).toHaveLength(3);
    expect(result.actions[0]!.reason).toContain('path=fallback');
    expect(result.actions[1]!.reason).toContain('path=rules');
    expect(result.actions[2]!.reason).toContain('path=rules');
  });
});

