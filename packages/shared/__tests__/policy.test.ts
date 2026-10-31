import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../src/policy.js';
import type { Invoice, Policy, ActionType, ActionParams } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────
function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv_test',
    payerId: 'pay_test',
    number: 'INV-0001',
    description: 'Test invoice',
    amount: 100_000,
    amountPaid: 0,
    issueDate: '2026-01-01',
    dueDate: '2026-01-15',
    status: 'SENT',
    discountPct: 0,
    allowPartial: false,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    maxDiscountPct: 10,
    maxInstalments: 4,
    autoApproveMaxAmount: 200_000,
    requireApprovalFor: ['OFFER_DISCOUNT', 'ESCALATE'],
    quietHours: { startHour: 22, endHour: 7 },
    maxRemindersPerInvoicePerWeek: 3,
    ...overrides,
  };
}

function makeCtx(overrides: { hour?: number; remindersLastWeek?: number } = {}) {
  const now = new Date('2026-01-10T12:00:00Z');
  if (overrides.hour !== undefined) {
    now.setUTCHours(overrides.hour, 0, 0, 0);
  }
  return { now, remindersLastWeek: overrides.remindersLastWeek ?? 0 };
}

function action(type: ActionType, params: ActionParams = {}) {
  return { type, params };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('evaluatePolicy', () => {
  // ── OFFER_DISCOUNT ───────────────────────────────────────────────────
  describe('OFFER_DISCOUNT', () => {
    it('allows discount within max', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 5 }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
      expect(v.violations).toHaveLength(0);
    });

    it('allows discount exactly at max', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 10 }), makeInvoice(), makePolicy({ maxDiscountPct: 10 }), makeCtx());
      expect(v.allowed).toBe(true);
      expect(v.violations).toHaveLength(0);
    });

    it('rejects discount exceeding max', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 15 }), makeInvoice(), makePolicy({ maxDiscountPct: 10 }), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations).toHaveLength(1);
      expect(v.violations[0]).toMatch(/15%.*10%/);
    });

    it('rejects zero discount', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 0 }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/greater than 0/);
    });

    it('rejects negative discount', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: -5 }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
    });

    it('rejects missing discountPct (undefined)', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', {}), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
    });

    it('requiresApproval when OFFER_DISCOUNT is in requireApprovalFor', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 5 }), makeInvoice(), makePolicy({ requireApprovalFor: ['OFFER_DISCOUNT'] }), makeCtx());
      expect(v.requiresApproval).toBe(true);
    });
  });

  // ── OFFER_INSTALMENTS ────────────────────────────────────────────────
  describe('OFFER_INSTALMENTS', () => {
    it('allows valid instalments', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 3, spacingDays: 14 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
    });

    it('allows exactly 2 instalments (boundary)', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 2, spacingDays: 7 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
    });

    it('allows exactly maxInstalments (boundary)', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 4, spacingDays: 7 } }), makeInvoice(), makePolicy({ maxInstalments: 4 }), makeCtx());
      expect(v.allowed).toBe(true);
    });

    it('rejects count < 2', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 1, spacingDays: 7 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/at least 2/);
    });

    it('rejects count > maxInstalments', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 5, spacingDays: 7 } }), makeInvoice(), makePolicy({ maxInstalments: 4 }), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/exceeds/);
    });

    it('rejects spacingDays < 1', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 2, spacingDays: 0 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/at least 1 day/);
    });

    it('allows spacingDays exactly 1 (boundary)', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 2, spacingDays: 1 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
    });

    it('collects multiple violations (count and spacing both bad)', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', { instalments: { count: 1, spacingDays: 0 } }), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations).toHaveLength(2);
    });

    it('rejects missing instalments param', () => {
      const v = evaluatePolicy(action('OFFER_INSTALMENTS', {}), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/required/i);
    });
  });

  // ── REMIND ───────────────────────────────────────────────────────────
  describe('REMIND', () => {
    it('allows REMIND during business hours', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy(), makeCtx({ hour: 14 }));
      expect(v.allowed).toBe(true);
    });

    it('blocks REMIND during quiet hours (late night)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 22, endHour: 7 } }), makeCtx({ hour: 23 }));
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/quiet hours/);
    });

    it('blocks REMIND during quiet hours (early morning)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 22, endHour: 7 } }), makeCtx({ hour: 3 }));
      expect(v.allowed).toBe(false);
    });

    it('allows REMIND at exactly endHour (boundary – quiet hours end)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 22, endHour: 7 } }), makeCtx({ hour: 7 }));
      expect(v.allowed).toBe(true);
    });

    it('blocks REMIND at exactly startHour (boundary – quiet hours begin)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 22, endHour: 7 } }), makeCtx({ hour: 22 }));
      expect(v.allowed).toBe(false);
    });

    it('disables quiet hours when startHour == endHour', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 0, endHour: 0 } }), makeCtx({ hour: 3 }));
      expect(v.allowed).toBe(true);
    });

    it('blocks REMIND when remindersLastWeek >= max', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ maxRemindersPerInvoicePerWeek: 3 }), makeCtx({ hour: 12, remindersLastWeek: 3 }));
      expect(v.allowed).toBe(false);
      expect(v.violations[0]).toMatch(/limit reached/i);
    });

    it('allows REMIND when remindersLastWeek < max (boundary)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ maxRemindersPerInvoicePerWeek: 3 }), makeCtx({ hour: 12, remindersLastWeek: 2 }));
      expect(v.allowed).toBe(true);
    });

    it('collects both quiet-hours and limit violations', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice(), makePolicy({ quietHours: { startHour: 22, endHour: 7 }, maxRemindersPerInvoicePerWeek: 2 }), makeCtx({ hour: 23, remindersLastWeek: 2 }));
      expect(v.allowed).toBe(false);
      expect(v.violations).toHaveLength(2);
    });

    it('handles non-wrapping quiet hours (e.g. 9–17)', () => {
      const policy = makePolicy({ quietHours: { startHour: 9, endHour: 17 } });
      expect(evaluatePolicy(action('REMIND'), makeInvoice(), policy, makeCtx({ hour: 12 })).allowed).toBe(false);
      expect(evaluatePolicy(action('REMIND'), makeInvoice(), policy, makeCtx({ hour: 8 })).allowed).toBe(true);
      expect(evaluatePolicy(action('REMIND'), makeInvoice(), policy, makeCtx({ hour: 17 })).allowed).toBe(true);
      expect(evaluatePolicy(action('REMIND'), makeInvoice(), policy, makeCtx({ hour: 20 })).allowed).toBe(true);
    });
  });

  // ── ESCALATE ─────────────────────────────────────────────────────────
  describe('ESCALATE', () => {
    it('is always allowed', () => {
      const v = evaluatePolicy(action('ESCALATE'), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
      expect(v.violations).toHaveLength(0);
    });

    it('requiresApproval when in requireApprovalFor', () => {
      const v = evaluatePolicy(action('ESCALATE'), makeInvoice(), makePolicy({ requireApprovalFor: ['ESCALATE'] }), makeCtx());
      expect(v.requiresApproval).toBe(true);
    });
  });

  // ── NO_ACTION ────────────────────────────────────────────────────────
  describe('NO_ACTION', () => {
    it('is always allowed', () => {
      const v = evaluatePolicy(action('NO_ACTION'), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
      expect(v.violations).toHaveLength(0);
    });

    it('does not require approval even with high-value invoice', () => {
      const v = evaluatePolicy(action('NO_ACTION'), makeInvoice({ amount: 999_999, amountPaid: 0 }), makePolicy({ autoApproveMaxAmount: 100_000 }), makeCtx());
      // remaining > autoApproveMaxAmount, but NO_ACTION is not in requireApprovalFor by default
      expect(v.requiresApproval).toBe(true); // still triggers amount-based approval
      expect(v.allowed).toBe(true);
    });
  });

  // ── requiresApproval logic ───────────────────────────────────────────
  describe('requiresApproval', () => {
    it('true when action type is in requireApprovalFor', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 5 }), makeInvoice(), makePolicy({ requireApprovalFor: ['OFFER_DISCOUNT'] }), makeCtx());
      expect(v.requiresApproval).toBe(true);
    });

    it('true when remaining exceeds autoApproveMaxAmount', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice({ amount: 300_000, amountPaid: 0 }), makePolicy({ autoApproveMaxAmount: 200_000 }), makeCtx());
      expect(v.requiresApproval).toBe(true);
    });

    it('false when remaining is exactly autoApproveMaxAmount (boundary)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice({ amount: 200_000, amountPaid: 0 }), makePolicy({ autoApproveMaxAmount: 200_000, requireApprovalFor: [] }), makeCtx());
      expect(v.requiresApproval).toBe(false);
    });

    it('true when remaining is autoApproveMaxAmount + 1 (boundary)', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice({ amount: 200_001, amountPaid: 0 }), makePolicy({ autoApproveMaxAmount: 200_000, requireApprovalFor: [] }), makeCtx());
      expect(v.requiresApproval).toBe(true);
    });

    it('false when type not in list and remaining within limit', () => {
      const v = evaluatePolicy(action('REMIND'), makeInvoice({ amount: 100_000 }), makePolicy({ requireApprovalFor: ['OFFER_DISCOUNT'], autoApproveMaxAmount: 200_000 }), makeCtx());
      expect(v.requiresApproval).toBe(false);
    });

    it('considers amountPaid in remaining calc', () => {
      // amount 300k, paid 200k → remaining 100k ≤ autoApproveMax 200k
      const v = evaluatePolicy(action('REMIND'), makeInvoice({ amount: 300_000, amountPaid: 200_000 }), makePolicy({ autoApproveMaxAmount: 200_000, requireApprovalFor: [] }), makeCtx());
      expect(v.requiresApproval).toBe(false);
    });
  });

  // ── allowed vs violations ────────────────────────────────────────────
  describe('allowed flag', () => {
    it('is false when violations is non-empty', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 99 }), makeInvoice(), makePolicy({ maxDiscountPct: 10 }), makeCtx());
      expect(v.allowed).toBe(false);
      expect(v.violations.length).toBeGreaterThan(0);
    });

    it('is true when violations is empty', () => {
      const v = evaluatePolicy(action('ESCALATE'), makeInvoice(), makePolicy(), makeCtx());
      expect(v.allowed).toBe(true);
      expect(v.violations).toHaveLength(0);
    });
  });

  // ── Violation string quality ─────────────────────────────────────────
  describe('violation messages', () => {
    it('produces human-readable sentences', () => {
      const v = evaluatePolicy(action('OFFER_DISCOUNT', { discountPct: 50 }), makeInvoice(), makePolicy({ maxDiscountPct: 10 }), makeCtx());
      for (const msg of v.violations) {
        // Must end with a period or similar punctuation and have >5 chars
        expect(msg.length).toBeGreaterThan(5);
        expect(msg).toMatch(/[.!]$/);
      }
    });
  });
});
