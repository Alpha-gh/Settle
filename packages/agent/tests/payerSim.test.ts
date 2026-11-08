import type { ActionRecord, ActionType, Invoice, Payer, PayerPersona } from '@settle/shared';
import { describe, expect, it } from 'vitest';
import { simulatePayerResponse } from '../src/payerSim/payerSim.js';

describe('Payer Simulator (simulatePayerResponse)', () => {
  const baseInvoice: Invoice = {
    id: 'inv_101',
    payerId: 'pay_101',
    number: 'INV-101',
    description: 'Services',
    amount: 100000, // $1,000.00
    amountPaid: 25000, // $250.00 (remaining: 75000 = $750.00)
    issueDate: '2026-10-15',
    dueDate: '2026-10-31',
    status: 'PARTIALLY_PAID',
    discountPct: 0,
    allowPartial: true,
  };

  function createAction(
    type: ActionType,
    params: ActionRecord['params'] = {},
  ): ActionRecord {
    return {
      id: 'act_001',
      invoiceId: baseInvoice.id,
      type,
      params,
      reason: 'Test action',
      policy: { allowed: true, requiresApproval: false, violations: [] },
      status: 'APPROVED',
      createdAt: '2026-11-05T10:00:00Z',
    };
  }

  function createPayer(persona: PayerPersona): Payer {
    return {
      id: 'pay_101',
      name: 'Test Customer',
      email: 'customer@test.com',
      persona,
      avgDaysLate: 10,
      latenessRisk: 0.3,
    };
  }

  describe('Persona x Action table tests', () => {
    it('reliable persona: pays remaining on REMIND', () => {
      const payer = createPayer('reliable');
      const action = createAction('REMIND');
      const res = simulatePayerResponse(action, baseInvoice, payer, 42);

      expect(res.responds).toBe(true);
      expect(res.accepts).toBe(true);
      expect(res.payAmount).toBe(75000); // full remaining
      expect(res.payDate).toMatch(/^2026-11-(05|06|07)$/);
      expect(res.message).toContain('$750.00');
    });

    it('slow persona: accepts OFFER_DISCOUNT if discountPct >= 2', () => {
      const payer = createPayer('slow');
      const action = createAction('OFFER_DISCOUNT', { discountPct: 3 });
      const res = simulatePayerResponse(action, baseInvoice, payer, 42);

      expect(res.responds).toBe(true);
      expect(res.accepts).toBe(true);
      // 75000 * 0.97 = 72750
      expect(res.payAmount).toBe(72750);
      expect(res.payDate).toMatch(/^2026-11-(05|06|07|08)$/);
      expect(res.message).toContain('$727.50');
    });

    it('slow persona: rejects discount if discountPct < 2', () => {
      const payer = createPayer('slow');
      const action = createAction('OFFER_DISCOUNT', { discountPct: 1 });
      const res = simulatePayerResponse(action, baseInvoice, payer, 42);

      expect(res.responds).toBe(false);
      expect(res.accepts).toBe(false);
      expect(res.payAmount).toBe(0);
    });

    it('slow persona: responds to REMIND but does not accept payment', () => {
      const payer = createPayer('slow');
      const action = createAction('REMIND');
      const res = simulatePayerResponse(action, baseInvoice, payer, 42);

      expect(res.responds).toBe(true);
      expect(res.accepts).toBe(false);
      expect(res.payAmount).toBe(0);
      expect(res.message).toContain('acknowledge receipt');
    });

    it('chronic persona: accepts OFFER_INSTALMENTS and pays first instalment with remainder', () => {
      const payer = createPayer('chronic');
      // Remaining: 75000 cents. 7 instalments: 75000 / 7 = 10714 with remainder 2 cents
      // First instalment = 10714 + 2 = 10716 cents.
      const action = createAction('OFFER_INSTALMENTS', {
        instalments: { count: 7, spacingDays: 14 },
      });
      const res = simulatePayerResponse(action, baseInvoice, payer, 42);

      expect(res.responds).toBe(true);
      expect(res.accepts).toBe(true);
      expect(res.payAmount).toBe(10716);
      expect(res.payDate).toMatch(/^2026-11-(05|06|07)$/);
      expect(res.message).toContain('$107.16');
    });

    it('chronic persona: ignores REMIND and OFFER_DISCOUNT', () => {
      const payer = createPayer('chronic');
      const resRemind = simulatePayerResponse(
        createAction('REMIND'),
        baseInvoice,
        payer,
        42,
      );
      expect(resRemind.responds).toBe(false);
      expect(resRemind.accepts).toBe(false);

      const resDiscount = simulatePayerResponse(
        createAction('OFFER_DISCOUNT', { discountPct: 5 }),
        baseInvoice,
        payer,
        42,
      );
      expect(resDiscount.responds).toBe(false);
      expect(resDiscount.accepts).toBe(false);
    });

    it('ghost persona: never responds or accepts any action', () => {
      const payer = createPayer('ghost');
      for (const actionType of [
        'REMIND',
        'OFFER_DISCOUNT',
        'OFFER_INSTALMENTS',
        'ESCALATE',
      ] as ActionType[]) {
        const res = simulatePayerResponse(
          createAction(actionType, { discountPct: 5, instalments: { count: 3, spacingDays: 30 } }),
          baseInvoice,
          payer,
          42,
        );
        expect(res.responds).toBe(false);
        expect(res.accepts).toBe(false);
        expect(res.payAmount).toBe(0);
      }
    });

    it('ESCALATE and NO_ACTION never receive a payer response for any persona', () => {
      for (const persona of ['reliable', 'slow', 'chronic', 'ghost'] as PayerPersona[]) {
        const payer = createPayer(persona);
        const resEscalate = simulatePayerResponse(
          createAction('ESCALATE'),
          baseInvoice,
          payer,
          42,
        );
        expect(resEscalate.responds).toBe(false);
        expect(resEscalate.accepts).toBe(false);

        const resNoAction = simulatePayerResponse(
          createAction('NO_ACTION'),
          baseInvoice,
          payer,
          42,
        );
        expect(resNoAction.responds).toBe(false);
        expect(resNoAction.accepts).toBe(false);
      }
    });
  });

  describe('Determinism & Invariants', () => {
    it('same seed produces byte-identical output across runs', () => {
      const payer = createPayer('reliable');
      const action = createAction('REMIND');

      const res1 = simulatePayerResponse(action, baseInvoice, payer, 999);
      const res2 = simulatePayerResponse(action, baseInvoice, payer, 999);
      expect(res1).toEqual(res2);
    });

    it('different seed only varies payDate within the allowed window', () => {
      const payer = createPayer('reliable');
      const action = createAction('REMIND');

      const results = Array.from({ length: 50 }, (_, i) =>
        simulatePayerResponse(action, baseInvoice, payer, i * 17),
      );

      for (const r of results) {
        expect(r.payAmount).toBe(75000);
        expect(r.accepts).toBe(true);
        expect(r.payDate >= '2026-11-05' && r.payDate <= '2026-11-07').toBe(true);
      }
    });

    it('payAmount is always an integer and never exceeds remaining balance', () => {
      const payer = createPayer('slow');
      const action = createAction('OFFER_DISCOUNT', { discountPct: 3 });

      for (let seed = 0; seed < 100; seed++) {
        const res = simulatePayerResponse(action, baseInvoice, payer, seed);
        expect(Number.isInteger(res.payAmount)).toBe(true);
        expect(res.payAmount).toBeLessThanOrEqual(75000);
        expect(res.payAmount).toBeGreaterThan(0);
      }
    });
  });
});

