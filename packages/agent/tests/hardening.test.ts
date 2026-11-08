import type { Invoice, Payer, Snapshot } from '@settle/shared';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/agent.js';
import { FixedClock } from '../src/clock.js';
import { DeterministicIdGen } from '../src/ids.js';
import { MockLlm } from '../src/llm/mockLlm.js';
import { FakeEngine } from '../test-support/fakeEngine.js';
import { buildSnapshot } from '../test-support/fixtures.js';

describe('Hardening & Invariants', () => {
  function setup(
    snapshotModifier?: (s: Snapshot) => void,
    engineModifier?: (e: FakeEngine) => void,
    llmOptions: ConstructorParameters<typeof MockLlm>[0] = { mode: 'good' },
  ) {
    const snapshot = buildSnapshot();
    if (snapshotModifier) snapshotModifier(snapshot);

    const engine = new FakeEngine({ defaultClosesGap: true });
    if (engineModifier) engineModifier(engine);

    const llm = new MockLlm(llmOptions);
    const clock = new FixedClock('2026-11-05T10:00:00Z');
    const idGen = new DeterministicIdGen();

    const agent = createAgent({
      engine,
      llm,
      clock,
      idGen,
    });

    return { agent, snapshot, engine, llm };
  }

  describe('Edge-case handling in runCycle', () => {
    it('zero overdue invoices produces empty actions and empty skipped', async () => {
      const { agent, snapshot } = setup((s) => {
        // Set all invoices to future due dates
        for (const inv of s.invoices) {
          inv.dueDate = '2026-12-01';
        }
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(0);
      expect(res.skipped).toHaveLength(0);
    });

    it('all invoices paid produces empty actions and empty skipped', async () => {
      const { agent, snapshot } = setup((s) => {
        for (const inv of s.invoices) {
          inv.status = 'PAID';
          inv.amountPaid = inv.amount;
        }
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(0);
      expect(res.skipped).toHaveLength(0);
    });

    it('invoice with remaining amount 0 is skipped', async () => {
      const { agent, snapshot } = setup((s) => {
        // Keep 1 overdue invoice, but remaining amount is 0
        s.invoices = [
          {
            ...s.invoices[0]!,
            amount: 50000,
            amountPaid: 50000,
            status: 'SENT',
            dueDate: '2026-10-20',
          },
        ];
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(0);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0]!.why).toContain('remaining balance');
    });

    it('engine throws on one invoice: that invoice is skipped while others proceed normally', async () => {
      const { agent, snapshot, engine } = setup((s) => {
        s.invoices = s.invoices.slice(0, 3);
      });

      const failingId = snapshot.invoices[1]!.id;
      const originalGenerate = engine.generateOptions.bind(engine);
      engine.generateOptions = (input, invoice, payer, policy) => {
        if (invoice.id === failingId) {
          throw new Error('Simulated engine failure for invoice');
        }
        return originalGenerate(input, invoice, payer, policy);
      };

      const res = await agent.runCycle(snapshot);
      expect(res.skipped.some((sk) => sk.invoiceId === failingId)).toBe(true);
      expect(res.actions.length).toBe(2);
      expect(res.actions.every((a) => a.invoiceId !== failingId)).toBe(true);
    });

    it('LLM timeout falls back cleanly to deterministic choice without crashing', async () => {
      const { agent, snapshot, llm } = setup(
        (s) => {
          s.invoices = s.invoices.slice(0, 1);
        },
        undefined,
        { mode: 'slow', slowDelayMs: 500 },
      );

      // Force generateStructured to simulate timeout/abort
      llm.generateStructured = async () => {
        const err = new Error('LLM request timed out after 15000ms');
        err.name = 'AbortError';
        throw err;
      };

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0]!.reason).toContain('path=fallback');
    });

    it('duplicate invoice ids in snapshot are handled gracefully', async () => {
      const { agent, snapshot } = setup((s) => {
        const first = s.invoices[0]!;
        s.invoices = [first, { ...first }];
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions.length).toBeGreaterThan(0);
    });

    it('two invoices with equal amounts maintain stable ordering', async () => {
      const { agent, snapshot } = setup((s) => {
        s.invoices = [
          {
            ...s.invoices[0]!,
            id: 'inv_b',
            number: 'INV-B',
            amount: 200000,
            amountPaid: 0,
            dueDate: '2026-10-25',
          },
          {
            ...s.invoices[0]!,
            id: 'inv_a',
            number: 'INV-A',
            amount: 200000,
            amountPaid: 0,
            dueDate: '2026-10-25',
          },
        ];
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(2);
      // Stable tie-breaker by invoice ID
      expect(res.actions[0]!.invoiceId).toBe('inv_a');
      expect(res.actions[1]!.invoiceId).toBe('inv_b');
    });

    it('PARTIALLY_PAID invoices correctly compute remaining balance and proceed', async () => {
      const { agent, snapshot } = setup((s) => {
        s.invoices = [
          {
            ...s.invoices[0]!,
            id: 'inv_part',
            amount: 100000,
            amountPaid: 40000,
            status: 'PARTIALLY_PAID',
            dueDate: '2026-10-20',
          },
        ];
      });

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0]!.reason).toBeDefined();
    });

    it('LLM returns option id from a different invoice set: rejected and falls back', async () => {
      const { agent, snapshot, llm } = setup(
        (s) => {
          s.invoices = s.invoices.slice(0, 1);
        },
        undefined,
        { mode: 'unknownId' }, // returns 'unknown_option_999'
      );

      const res = await agent.runCycle(snapshot);
      expect(res.actions).toHaveLength(1);
      expect(res.actions[0]!.reason).toContain('path=fallback');
      const metrics = agent.getLastRunMetrics();
      expect(metrics.fallbacks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Model Invariants', () => {
    it('model path never produces status EXECUTED or decidedBy "owner"', async () => {
      const { agent, snapshot } = setup();
      const res = await agent.runCycle(snapshot);

      for (const act of res.actions) {
        expect(act.status).not.toBe('EXECUTED');
        expect(act.decidedBy).not.toBe('owner');
        expect(['APPROVED', 'AWAITING_APPROVAL', 'BLOCKED']).toContain(act.status);
      }
    });
  });

  describe('Code Hygiene & Isolation Rules', () => {
    function getAllTsFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(getAllTsFiles(fullPath));
        } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const srcDir = path.resolve(__dirname, '../src');
    const tsFiles = getAllTsFiles(srcDir);

    it('no file in src/ calls Date.now', () => {
      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf8');
        expect(
          content.includes('Date.now()'),
          `Forbidden Date.now() found in ${file}`,
        ).toBe(false);
      }
    });

    it('new Date() exists ONLY in src/clock.ts', () => {
      for (const file of tsFiles) {
        const normalized = file.replace(/\\/g, '/');
        const content = fs.readFileSync(file, 'utf8');
        if (!normalized.endsWith('/clock.ts')) {
          expect(
            content.includes('new Date('),
            `Forbidden new Date() found outside clock.ts in ${file}`,
          ).toBe(false);
        }
      }
    });

    it('no file in src/ calls Math.random', () => {
      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf8');
        expect(
          content.includes('Math.random()'),
          `Forbidden Math.random() found in ${file}`,
        ).toBe(false);
      }
    });

    it('fetch calls exist ONLY in src/llm/', () => {
      for (const file of tsFiles) {
        const normalized = file.replace(/\\/g, '/');
        const content = fs.readFileSync(file, 'utf8');
        if (!normalized.includes('/src/llm/')) {
          expect(
            /\bfetch\s*\(/.test(content),
            `Forbidden fetch() found outside src/llm/ in ${file}`,
          ).toBe(false);
        }
      }
    });

    it('no file in src/ imports anything from apps/*', () => {
      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf8');
        expect(
          /from\s+['"][^'"]*apps\//.test(content),
          `Forbidden import from apps/* found in ${file}`,
        ).toBe(false);
      }
    });
  });
});
