import type { ActionType, ActionParams, Invoice, Policy, PolicyVerdict } from './types.js';

export function evaluatePolicy(
  action: { type: ActionType; params: ActionParams },
  invoice: Invoice,
  policy: Policy,
  ctx: { now: Date; remindersLastWeek: number },
): PolicyVerdict {
  const violations: string[] = [];
  const remaining = invoice.amount - invoice.amountPaid;

  switch (action.type) {
    case 'OFFER_DISCOUNT': {
      const pct = action.params.discountPct ?? 0;
      if (pct <= 0) {
        violations.push('Discount percentage must be greater than 0.');
      } else if (pct > policy.maxDiscountPct) {
        violations.push(
          `Discount of ${pct}% exceeds the maximum allowed ${policy.maxDiscountPct}%.`,
        );
      }
      break;
    }

    case 'OFFER_INSTALMENTS': {
      const inst = action.params.instalments;
      if (!inst) {
        violations.push('Instalment parameters are required.');
        break;
      }
      if (inst.count < 2) {
        violations.push(`Instalment count must be at least 2 (got ${inst.count}).`);
      } else if (inst.count > policy.maxInstalments) {
        violations.push(
          `Instalment count of ${inst.count} exceeds the maximum allowed ${policy.maxInstalments}.`,
        );
      }
      if (inst.spacingDays < 1) {
        violations.push(`Instalment spacing must be at least 1 day (got ${inst.spacingDays}).`);
      }
      break;
    }

    case 'REMIND': {
      const { startHour, endHour } = policy.quietHours;
      const quietEnabled = startHour !== endHour;
      if (quietEnabled) {
        const hour = ctx.now.getUTCHours();
        const inQuiet =
          startHour < endHour
            ? hour >= startHour && hour < endHour
            : hour >= startHour || hour < endHour;
        if (inQuiet) {
          violations.push(
            `Reminders are not allowed during quiet hours (${startHour}:00–${endHour}:00 UTC).`,
          );
        }
      }
      if (ctx.remindersLastWeek >= policy.maxRemindersPerInvoicePerWeek) {
        violations.push(
          `Reminder limit reached: ${ctx.remindersLastWeek} of ${policy.maxRemindersPerInvoicePerWeek} allowed per invoice per week already sent.`,
        );
      }
      break;
    }

    case 'ESCALATE':
    case 'NO_ACTION':
      // Always allowed
      break;
  }

  const requiresApproval =
    (policy.requireApprovalFor as string[]).includes(action.type) ||
    remaining > policy.autoApproveMaxAmount;

  return {
    allowed: violations.length === 0,
    requiresApproval,
    violations,
  };
}
