function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

import { eq } from 'drizzle-orm';
import type { Invoice, Id, Cents, AuditActor, AuditEvent, ForecastResult, PayPalPort } from '@settle/shared';
import { getDb } from '../db/index.js';
import { businesses, invoices, auditEvents } from '../db/schema.js';
import {
  AuditEventRepository,
  BusinessRepository,
  PayerRepository,
  InvoiceRepository,
  ObligationRepository,
} from '../db/repositories.js';
import { eventBus } from '../events/bus.js';
import { getEngine } from '../adapters/engine.js';

export interface ReconcilePaymentParams {
  invoiceId: Id;
  paypalInvoiceId: string;
  actor?: AuditActor;
  eventType?: string;
  eventId?: string;
  paypalRequestId?: string;
  extraDetail?: Record<string, unknown>;
}

export interface ReconcilePaymentResult {
  invoice: Invoice;
  delta: Cents;
  previousBalance: Cents;
  newBalance: Cents;
  forecast?: ForecastResult;
}

export class PaymentReconciliationService {
  private readonly auditRepo = new AuditEventRepository();
  private readonly businessRepo = new BusinessRepository();
  private readonly payerRepo = new PayerRepository();
  private readonly invoiceRepo = new InvoiceRepository();
  private readonly obligationRepo = new ObligationRepository();

  constructor(private readonly paypalClient: PayPalPort) {}

  /**
   * Reconciles invoice state with PayPal and updates business startingBalance atomically.
   * Single code path used by both simulate-payment reconcile and the PayPal webhook handler.
   */
  async reconcileInvoicePayment(params: ReconcilePaymentParams): Promise<ReconcilePaymentResult> {
    const { status: liveStatus, amountPaid: liveAmountPaid } =
      await this.paypalClient.getInvoice(params.paypalInvoiceId);

    const db = getDb();

    // Atomic transaction: update startingBalance, invoice state, and audit event atomically
    const { updatedInvoice, delta, previousBalance, newBalance, payAudit } = await db.transaction(async (tx) => {
      const [currentInv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, params.invoiceId))
        .limit(1);

      if (!currentInv) {
        throw new Error(`Invoice ${params.invoiceId} not found`);
      }

      const storedAmountPaid = currentInv.amountPaid;
      const delta = liveAmountPaid - storedAmountPaid;

      const [currentBiz] = await tx
        .select()
        .from(businesses)
        .limit(1);

      const previousBalance = currentBiz?.startingBalance ?? 0;
      let newBalance = previousBalance;

      // When invoice amountPaid increases by a positive delta, add delta to stored startingBalance.
      // For a refund (amountPaid decreases), subtract delta.
      // If delta === 0 (duplicate webhook or repeat reconcile), balance is unchanged.
      if (delta !== 0 && currentBiz) {
        newBalance = previousBalance + delta;
        await tx
          .update(businesses)
          .set({ startingBalance: newBalance })
          .where(eq(businesses.id, currentBiz.id));
      }

      const [updated] = await tx
        .update(invoices)
        .set({
          status: liveStatus,
          amountPaid: liveAmountPaid,
        })
        .where(eq(invoices.id, params.invoiceId))
        .returning();

      // Append audit event stating amount received and new cash balance
      let auditSummary = '';
      let auditKind = params.eventType || 'invoice.paid';

      if (delta > 0) {
        auditKind =
          params.eventType && params.eventType.startsWith('INVOICING.')
            ? params.eventType
            : 'invoice.paid';
        auditSummary = `Payment of ${formatMoney(delta)} received for invoice ${updated.number}. New cash balance: ${formatMoney(newBalance)}.`;
      } else if (delta < 0) {
        auditKind =
          params.eventType && params.eventType.startsWith('INVOICING.')
            ? params.eventType
            : 'invoice.refunded';
        auditSummary = `Refund of ${formatMoney(Math.abs(delta))} processed for invoice ${updated.number}. New cash balance: ${formatMoney(newBalance)}.`;
      } else {
        auditSummary = `Reconciled invoice ${updated.number} with status ${liveStatus} and amount paid ${formatMoney(liveAmountPaid)}. Cash balance unchanged: ${formatMoney(newBalance)}.`;
      }

      const payAudit: AuditEvent = {
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: new Date().toISOString(),
        actor: params.actor ?? 'paypal',
        kind: auditKind,
        summary: auditSummary,
        invoiceId: updated.id,
        paypalRequestId: params.paypalRequestId,
        detail: {
          delta,
          amountReceived: delta > 0 ? delta : 0,
          refundAmount: delta < 0 ? Math.abs(delta) : 0,
          previousCashBalance: previousBalance,
          newCashBalance: newBalance,
          reconciledStatus: liveStatus,
          reconciledAmountPaid: liveAmountPaid,
          paypalInvoiceId: params.paypalInvoiceId,
          eventId: params.eventId,
          ...params.extraDetail,
        },
      };

      await tx.insert(auditEvents).values({
        id: payAudit.id,
        ts: payAudit.ts,
        actor: payAudit.actor,
        kind: payAudit.kind,
        summary: payAudit.summary,
        invoiceId: payAudit.invoiceId,
        actionId: payAudit.actionId,
        paypalRequestId: payAudit.paypalRequestId,
        detail: payAudit.detail,
      });

      return {
        updatedInvoice: {
          ...updated,
          minimumAmountDue: updated.minimumAmountDue ?? undefined,
          paypalInvoiceId: updated.paypalInvoiceId ?? undefined,
          payUrl: updated.payUrl ?? undefined,
        },
        delta,
        previousBalance,
        newBalance,
        payAudit,
      };
    });

    // Emitted only after transaction successfully commits
    eventBus.emitEvent({ type: 'audit.appended', payload: payAudit });
    eventBus.emitEvent({ type: 'invoice.updated', payload: updatedInvoice });

    // Recompute forecast with latest business startingBalance and invoices
    const business = await this.businessRepo.get();
    const payers = await this.payerRepo.list();
    const allInvoices = await this.invoiceRepo.list();
    const obligations = await this.obligationRepo.list();

    let forecast: ForecastResult | undefined;
    if (business) {
      const engine = await getEngine();
      const receipts = engine.expectedReceipts(allInvoices, payers, business.asOf);
      forecast = engine.forecast({
        business,
        obligations,
        receipts,
        horizonDays: 30,
      });

      // Emit forecast.updated after the change
      eventBus.emitEvent({ type: 'forecast.updated', payload: forecast });
    }

    return {
      invoice: updatedInvoice,
      delta,
      previousBalance,
      newBalance,
      forecast,
    };
  }
}
