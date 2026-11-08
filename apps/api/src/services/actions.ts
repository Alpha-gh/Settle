import { randomUUID } from 'node:crypto';
import {
  type ActionRecord,
  type Invoice,
  type Policy,
  type AuditEvent,
  type Payer,
  type PayPalPort,
  evaluatePolicy,
  type ISODate,
} from '@settle/shared';
import {
  ActionRecordRepository,
  AuditEventRepository,
  InvoiceRepository,
  InvoicePayPalIdRepository,
  PayerRepository,
  PolicyRepository,
} from '../db/repositories.js';
import { eventBus } from '../events/bus.js';
import { getEnv } from '../config/env.js';
import { centsToPayPalString } from '../paypal/money.js';

export class NotProvisionedError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'NOT_PROVISIONED';

  constructor(message = 'Invoice is not provisioned in PayPal') {
    super(message);
    this.name = 'NotProvisionedError';
  }
}

export class ActionNotOpenError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'ACTION_NOT_OPEN';

  constructor(message = 'Action is not open for approval') {
    super(message);
    this.name = 'ActionNotOpenError';
  }
}

// In-memory per-action locks so concurrent approvals execute once
const actionExecutionLocks = new Map<string, Promise<ActionRecord>>();

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

function isoDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export class ActionService {
  constructor(
    private readonly actionRepo: ActionRecordRepository,
    private readonly invoiceRepo: InvoiceRepository,
    private readonly payerRepo: PayerRepository,
    private readonly policyRepo: PolicyRepository,
    private readonly auditRepo: AuditEventRepository,
    private readonly historyRepo: InvoicePayPalIdRepository,
    private readonly paypalClient: PayPalPort,
  ) {}

  /**
   * Counts reminders sent for this invoice in the last 7 days.
   */
  public async countRemindersLastWeek(invoiceId: string, now: Date): Promise<number> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const audits = await this.auditRepo.list(200);

    const reminderAudits = audits.filter(
      (a) =>
        a.invoiceId === invoiceId &&
        (a.kind === 'reminder.sent' || a.kind === 'action.executed') &&
        a.ts >= sevenDaysAgo,
    );

    return reminderAudits.length;
  }

  /**
   * Executes an action with per-action lock, policy verification, and PayPal interaction.
   */
  public async executeAction(
    actionId: string,
    decidedBy: 'owner' | 'auto' = 'owner',
  ): Promise<ActionRecord> {
    // If execution for this action is already running, wait for it (concurrent lock)
    const existingExecution = actionExecutionLocks.get(actionId);
    if (existingExecution) {
      return existingExecution;
    }

    const executionPromise = this._executeActionInternal(actionId, decidedBy);
    actionExecutionLocks.set(actionId, executionPromise);

    try {
      return await executionPromise;
    } finally {
      actionExecutionLocks.delete(actionId);
    }
  }

  private async _executeActionInternal(
    actionId: string,
    decidedBy: 'owner' | 'auto',
  ): Promise<ActionRecord> {
    const action = await this.actionRepo.getById(actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    // Idempotent: if already EXECUTED, return record
    if (action.status === 'EXECUTED') {
      return action;
    }

    // Closed action guard: an approve call on a closed action must never execute anything
    if (action.status === 'REJECTED' || action.status === 'FAILED') {
      throw new ActionNotOpenError(`Action ${actionId} is not open for approval (status: ${action.status})`);
    }

    const invoice = await this.invoiceRepo.getById(action.invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${action.invoiceId} not found`);
    }

    // 409 NOT_PROVISIONED Guard: actions needing PayPal require paypalInvoiceId
    const requiresPayPal = ['REMIND', 'OFFER_DISCOUNT', 'OFFER_INSTALMENTS'].includes(action.type);
    if (requiresPayPal && !invoice.paypalInvoiceId) {
      throw new NotProvisionedError('Invoice is not provisioned in PayPal');
    }

    // Server-side policy re-evaluation at approval/execution time
    const env = getEnv();
    const now = new Date();
    const remindersLastWeek = await this.countRemindersLastWeek(invoice.id, now);
    const policy = await this.policyRepo.get();
    const effectivePolicy: Policy = env.POLICY_IGNORE_QUIET_HOURS
      ? { ...policy, quietHours: { startHour: 0, endHour: 0 } }
      : policy;

    const verdict = evaluatePolicy(
      { type: action.type, params: action.params },
      invoice,
      effectivePolicy,
      { now, remindersLastWeek },
    );

    if (!verdict.allowed) {
      // Policy violation at approval time blocks execution
      const blockedAction: ActionRecord = {
        ...action,
        status: 'BLOCKED',
        policy: verdict,
      };
      await this.actionRepo.update(blockedAction);

      const blockedAudit: AuditEvent = {
        id: randomUUID(),
        ts: now.toISOString(),
        actor: 'system',
        kind: 'action.blocked_by_policy',
        summary: `Action ${action.id} (${action.type}) blocked by policy at execution time: ${verdict.violations.join(' ')}`,
        invoiceId: invoice.id,
        actionId: action.id,
        detail: { violations: verdict.violations },
      };
      await this.auditRepo.append(blockedAudit);
      eventBus.emitEvent({ type: 'audit.appended', payload: blockedAudit });
      eventBus.emitEvent({ type: 'action.updated', payload: blockedAction });

      return blockedAction;
    }

    // Mark as APPROVED before executing if not already
    action.status = 'APPROVED';
    action.decidedBy = decidedBy;
    action.policy = verdict;

    try {
      if (action.type === 'REMIND') {
        const payUrl =
          invoice.payUrl ||
          (invoice.paypalInvoiceId ? `https://www.sandbox.paypal.com/invoice/p/#${invoice.paypalInvoiceId}` : '');
        const defaultNote = `Friendly reminder that your invoice ${invoice.number} is due. Please review and pay here: {{PAY_URL}}`;
        const rawNote = action.params.note || defaultNote;
        const noteWithUrl = rawNote.replace(/\{\{PAY_URL\}\}/g, payUrl);

        await this.paypalClient.sendReminder(invoice.paypalInvoiceId!, noteWithUrl);

        const auditTrail = typeof (this.paypalClient as any).getAuditTrail === 'function'
          ? (this.paypalClient as any).getAuditTrail()
          : [];
        const lastAudit = auditTrail[auditTrail.length - 1];
        const reqId = lastAudit?.paypalRequestId || randomUUID();

        action.status = 'EXECUTED';
        action.executedAt = new Date().toISOString();
        action.paypalRequestId = reqId;
        await this.actionRepo.update(action);

        const auditEvt: AuditEvent = {
          id: randomUUID(),
          ts: action.executedAt,
          actor: 'paypal',
          kind: 'reminder.sent',
          summary: `Reminder sent for invoice ${invoice.number} via PayPal`,
          invoiceId: invoice.id,
          actionId: action.id,
          paypalRequestId: reqId,
          detail: { note: noteWithUrl, payUrl },
        };
        await this.auditRepo.append(auditEvt);
        eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });
        eventBus.emitEvent({ type: 'action.updated', payload: action });

        return action;
      }

      if (action.type === 'OFFER_DISCOUNT') {
        const discountPct = action.params.discountPct ?? 5;
        const newDueDate = isoDate(addDays(new Date(), 7));

        await this.paypalClient.updateInvoice(invoice.paypalInvoiceId!, {
          discountPct,
          dueDate: newDueDate,
        });

        // Update local invoice state
        const updatedInvoice = await this.invoiceRepo.update(invoice.id, {
          discountPct,
          dueDate: newDueDate,
        });

        // Send follow-up reminder with updated terms
        const payUrl =
          updatedInvoice?.payUrl ||
          invoice.payUrl ||
          `https://www.sandbox.paypal.com/invoice/p/#${invoice.paypalInvoiceId}`;
        const discountNote = `We have applied a ${discountPct}% discount to your invoice ${invoice.number}. New due date: ${newDueDate}. Pay here: ${payUrl}`;
        await this.paypalClient.sendReminder(invoice.paypalInvoiceId!, discountNote);

        const auditTrail = typeof (this.paypalClient as any).getAuditTrail === 'function'
          ? (this.paypalClient as any).getAuditTrail()
          : [];
        const lastAudit = auditTrail[auditTrail.length - 1];
        const reqId = lastAudit?.paypalRequestId || randomUUID();

        action.status = 'EXECUTED';
        action.executedAt = new Date().toISOString();
        action.paypalRequestId = reqId;
        await this.actionRepo.update(action);

        if (updatedInvoice) {
          eventBus.emitEvent({ type: 'invoice.updated', payload: updatedInvoice });
        }

        const auditEvt: AuditEvent = {
          id: randomUUID(),
          ts: action.executedAt,
          actor: 'paypal',
          kind: 'discount.applied',
          summary: `Applied ${discountPct}% discount to invoice ${invoice.number} with new due date ${newDueDate}`,
          invoiceId: invoice.id,
          actionId: action.id,
          paypalRequestId: reqId,
          detail: { discountPct, newDueDate },
        };
        await this.auditRepo.append(auditEvt);
        eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });
        eventBus.emitEvent({ type: 'action.updated', payload: action });

        return action;
      }

      if (action.type === 'OFFER_INSTALMENTS') {
        const inst = action.params.instalments!;
        const count = inst.count;
        const spacingDays = inst.spacingDays;
        const remainingAmount = invoice.amount - invoice.amountPaid;

        const baseCents = Math.floor(remainingAmount / count);
        const remainderCents = remainingAmount % count;

        const payer = await this.payerRepo.getById(invoice.payerId);
        if (!payer) {
          throw new Error(`Payer ${invoice.payerId} not found`);
        }

        const createdChildren: Array<{
          childInv: Invoice;
          paypalInvoiceId: string;
          payUrl: string;
          paypalInvoiceNumber?: string;
          requestId?: string;
        }> = [];

        const today = new Date().toISOString().slice(0, 10);

        try {
          for (let i = 1; i <= count; i++) {
            // First part takes the remainder cents
            const partAmount = i === 1 ? baseCents + remainderCents : baseCents;
            const daysFromNow = 3 + (i - 1) * spacingDays;
            const partDueDate = isoDate(addDays(new Date(), daysFromNow));
            const partNumber = `${invoice.number}-${i}/${count}`;
            const partDesc = `${invoice.description} (Instalment ${i}/${count} of parent ${invoice.number})`;
            const partId = `inv_inst_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

            const childInv: Invoice = {
              id: partId,
              payerId: invoice.payerId,
              number: partNumber,
              description: partDesc,
              amount: partAmount,
              amountPaid: 0,
              issueDate: today,
              dueDate: partDueDate,
              status: 'SENT',
              discountPct: 0,
              allowPartial: false,
            };

            const res = await this.paypalClient.createAndSendInvoice(childInv, payer);
            const auditTrail = typeof (this.paypalClient as any).getAuditTrail === 'function'
              ? (this.paypalClient as any).getAuditTrail()
              : [];
            const lastAudit = auditTrail[auditTrail.length - 1];

            createdChildren.push({
              childInv: {
                ...childInv,
                paypalInvoiceId: res.paypalInvoiceId,
                payUrl: res.payUrl,
              },
              paypalInvoiceId: res.paypalInvoiceId,
              payUrl: res.payUrl,
              paypalInvoiceNumber: (res as any).paypalInvoiceNumber,
              requestId: lastAudit?.paypalRequestId || randomUUID(),
            });
          }
        } catch (childErr: any) {
          // If any child fails, cancel the children already created, leave original untouched, mark action FAILED
          for (const created of createdChildren) {
            try {
              if (typeof (this.paypalClient as any).cancelInvoice === 'function') {
                await (this.paypalClient as any).cancelInvoice(created.paypalInvoiceId);
              } else if (typeof (this.paypalClient as any).request === 'function') {
                await (this.paypalClient as any).request({
                  method: 'POST',
                  path: `/v2/invoicing/invoices/${created.paypalInvoiceId}/cancel`,
                  operation: 'cancelInvoice',
                });
              }
            } catch {
              // best effort rollback
            }
          }

          action.status = 'FAILED';
          action.error = childErr?.message || String(childErr);
          await this.actionRepo.update(action);

          const failAudit: AuditEvent = {
            id: randomUUID(),
            ts: new Date().toISOString(),
            actor: 'system',
            kind: 'action.failed',
            summary: `Offer instalments failed for invoice ${invoice.number}: ${action.error}`,
            invoiceId: invoice.id,
            actionId: action.id,
            detail: { error: action.error, createdCount: createdChildren.length },
          };
          await this.auditRepo.append(failAudit);
          eventBus.emitEvent({ type: 'audit.appended', payload: failAudit });
          eventBus.emitEvent({ type: 'action.updated', payload: action });

          return action;
        }

        // Only after ALL children are created and sent:
        // 1. Persist child invoices and audit events
        for (const created of createdChildren) {
          await this.invoiceRepo.insert(created.childInv);
          await this.historyRepo.record(created.childInv.id, created.paypalInvoiceId, 'instalment_child', (created as any).paypalInvoiceNumber);

          const childAudit: AuditEvent = {
            id: randomUUID(),
            ts: new Date().toISOString(),
            actor: 'paypal',
            kind: 'instalment.child_created',
            summary: `Instalment ${created.childInv.number} created for parent ${invoice.number}`,
            invoiceId: created.childInv.id,
            actionId: action.id,
            paypalRequestId: created.requestId,
            detail: {
              parentInvoiceId: invoice.id,
              amount: created.childInv.amount,
              dueDate: created.childInv.dueDate,
              paypalInvoiceId: created.paypalInvoiceId,
            },
          };
          await this.auditRepo.append(childAudit);
          eventBus.emitEvent({ type: 'audit.appended', payload: childAudit });
          eventBus.emitEvent({ type: 'invoice.updated', payload: created.childInv });
        }

        // 2. Cancel original invoice and mark superseded
        if (invoice.paypalInvoiceId) {
          await this.historyRepo.markReplaced(invoice.paypalInvoiceId, 'split_into_instalments');
          try {
            if (typeof (this.paypalClient as any).cancelInvoice === 'function') {
              await (this.paypalClient as any).cancelInvoice(invoice.paypalInvoiceId);
            } else if (typeof (this.paypalClient as any).request === 'function') {
              await (this.paypalClient as any).request({
                method: 'POST',
                path: `/v2/invoicing/invoices/${invoice.paypalInvoiceId}/cancel`,
                operation: 'cancelInvoice',
              });
            }
          } catch {
            // ignore
          }
        }

        const updatedParent = await this.invoiceRepo.update(invoice.id, {
          status: 'CANCELLED',
        });
        if (updatedParent) {
          eventBus.emitEvent({ type: 'invoice.updated', payload: updatedParent });
        }

        action.status = 'EXECUTED';
        action.executedAt = new Date().toISOString();
        action.paypalRequestId = createdChildren[0]?.requestId;
        await this.actionRepo.update(action);

        const parentSupersededAudit: AuditEvent = {
          id: randomUUID(),
          ts: action.executedAt,
          actor: 'paypal',
          kind: 'invoice.superseded_instalments',
          summary: `Original invoice ${invoice.number} cancelled and replaced by ${count} instalments`,
          invoiceId: invoice.id,
          actionId: action.id,
          paypalRequestId: action.paypalRequestId,
          detail: {
            childInvoiceIds: createdChildren.map((c) => c.childInv.id),
          },
        };
        await this.auditRepo.append(parentSupersededAudit);
        eventBus.emitEvent({ type: 'audit.appended', payload: parentSupersededAudit });
        eventBus.emitEvent({ type: 'action.updated', payload: action });

        return action;
      }

      if (action.type === 'ESCALATE' || action.type === 'NO_ACTION') {
        // ESCALATE and NO_ACTION: no PayPal call; audit "owner task created"
        action.status = 'EXECUTED';
        action.executedAt = new Date().toISOString();
        await this.actionRepo.update(action);

        const taskAudit: AuditEvent = {
          id: randomUUID(),
          ts: action.executedAt,
          actor: decidedBy === 'auto' ? 'agent' : 'owner',
          kind: 'owner.task_created',
          summary: `owner task created: ${action.type} for invoice ${invoice.number}`,
          invoiceId: invoice.id,
          actionId: action.id,
          detail: {
            actionType: action.type,
            reason: action.reason,
            simulation: action.simulation,
          },
        };
        await this.auditRepo.append(taskAudit);
        eventBus.emitEvent({ type: 'audit.appended', payload: taskAudit });
        eventBus.emitEvent({ type: 'action.updated', payload: action });

        return action;
      }

      return action;
    } catch (err: any) {
      action.status = 'FAILED';
      action.error = err?.message || String(err);
      await this.actionRepo.update(action);

      const failAudit: AuditEvent = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        actor: 'system',
        kind: 'action.failed',
        summary: `Action ${action.id} (${action.type}) failed: ${action.error}`,
        invoiceId: invoice.id,
        actionId: action.id,
        detail: { error: action.error },
      };
      await this.auditRepo.append(failAudit);
      eventBus.emitEvent({ type: 'audit.appended', payload: failAudit });
      eventBus.emitEvent({ type: 'action.updated', payload: action });

      return action;
    }
  }

  /**
   * Rejection of an action by owner
   */
  public async rejectAction(actionId: string, note?: string): Promise<ActionRecord> {
    const action = await this.actionRepo.getById(actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    action.status = 'REJECTED';
    action.decidedBy = 'owner';
    await this.actionRepo.update(action);

    const rejectAudit: AuditEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      actor: 'owner',
      kind: 'action.rejected',
      summary: `Action ${action.id} rejected by owner`,
      actionId: action.id,
      invoiceId: action.invoiceId,
      detail: { note },
    };
    await this.auditRepo.append(rejectAudit);
    eventBus.emitEvent({ type: 'audit.appended', payload: rejectAudit });
    eventBus.emitEvent({ type: 'action.updated', payload: action });

    return action;
  }
}
