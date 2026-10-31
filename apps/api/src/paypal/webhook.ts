import type { FastifyBaseLogger } from 'fastify';
import type { AuditEvent, Id } from '@settle/shared';
import { getEnv } from '../config/env.js';
import {
  InvoiceRepository,
  AuditEventRepository,
  InvoicePayPalIdRepository,
  WebhookEventRepository,
  BusinessRepository,
  PayerRepository,
  ObligationRepository,
} from '../db/repositories.js';
import { getEngine } from '../adapters/engine.js';
import { eventBus } from '../events/bus.js';
import { PayPalClient } from './client.js';

export interface PayPalWebhookHeaders {
  'paypal-auth-algo'?: string;
  'paypal-cert-url'?: string;
  'paypal-transmission-id'?: string;
  'paypal-transmission-sig'?: string;
  'paypal-transmission-time'?: string;
}

export class PayPalWebhookHandler {
  private readonly invoiceRepo = new InvoiceRepository();
  private readonly auditRepo = new AuditEventRepository();
  private readonly historyRepo = new InvoicePayPalIdRepository();
  private readonly webhookEventRepo = new WebhookEventRepository();
  private readonly businessRepo = new BusinessRepository();
  private readonly payerRepo = new PayerRepository();
  private readonly obligationRepo = new ObligationRepository();

  constructor(
    private readonly paypalClient: PayPalClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Verifies incoming webhook signature with PayPal API.
   * Skips verification with a loud warning when WEBHOOK_VERIFY=false.
   */
  async verifySignature(
    headers: PayPalWebhookHeaders,
    body: any,
  ): Promise<boolean> {
    const env = getEnv();

    if (!env.WEBHOOK_VERIFY) {
      this.logger.warn(
        '⚠️  [SECURITY WARNING] PayPal webhook signature verification is DISABLED (WEBHOOK_VERIFY=false). Do not use in production!',
      );
      return true;
    }

    if (!env.PAYPAL_WEBHOOK_ID) {
      this.logger.warn(
        '⚠️  PAYPAL_WEBHOOK_ID is not configured. Rejecting webhook verification.',
      );
      return false;
    }

    const authAlgo = headers['paypal-auth-algo'];
    const certUrl = headers['paypal-cert-url'];
    const transmissionId = headers['paypal-transmission-id'];
    const transmissionSig = headers['paypal-transmission-sig'];
    const transmissionTime = headers['paypal-transmission-time'];

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      this.logger.warn({ headers }, 'Missing required PayPal verification headers');
      return false;
    }

    try {
      const auth = (this.paypalClient as any).authenticator;
      const token = await auth.getAccessToken();

      const verifyRes = await fetch(
        `${env.PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: env.PAYPAL_WEBHOOK_ID,
            webhook_event: body,
          }),
        },
      );

      if (!verifyRes.ok) {
        this.logger.error(
          { status: verifyRes.status, body: await verifyRes.text() },
          'PayPal webhook verification request failed',
        );
        return false;
      }

      const data = (await verifyRes.json()) as { verification_status: string };
      return data.verification_status === 'SUCCESS';
    } catch (err) {
      this.logger.error({ err }, 'Error calling PayPal verify-webhook-signature API');
      return false;
    }
  }

  /**
   * Processes the verified webhook event.
   * Deduplicates by event.id; handles event types; updates DB; emits SSE.
   */
  async processEvent(event: any): Promise<{ handled: boolean; duplicate: boolean }> {
    const eventId = event?.id;
    const eventType = event?.event_type;

    if (!eventId || !eventType) {
      return { handled: false, duplicate: false };
    }

    // Deduplication check
    const isNew = await this.webhookEventRepo.recordEvent(eventId, eventType);
    if (!isNew) {
      this.logger.info({ eventId, eventType }, 'Duplicate webhook event received, skipping');
      return { handled: true, duplicate: true };
    }

    this.logger.info({ eventId, eventType }, 'Processing PayPal webhook event');

    // Extract invoice identifier from event resource
    const resource = event.resource || {};
    const paypalInvoiceId: string | undefined =
      resource.invoice?.id || resource.id || resource.invoice_id;

    if (!paypalInvoiceId) {
      this.logger.warn({ eventId, eventType }, 'Webhook event missing invoice ID in resource');
      return { handled: true, duplicate: false };
    }

    // Find corresponding Settle invoice
    const settleInvoice = await this.invoiceRepo.getByPayPalInvoiceId(paypalInvoiceId);
    if (!settleInvoice) {
      this.logger.warn(
        { paypalInvoiceId, eventType },
        'No matching Settle invoice found for PayPal invoice ID',
      );
      return { handled: true, duplicate: false };
    }

    // Check if this paypalInvoiceId was replaced / superseded
    const historyEntry = await this.historyRepo.findByPayPalId(paypalInvoiceId);
    const isSuperseded = !!historyEntry?.replacedAt;

    if (eventType === 'INVOICING.INVOICE.CANCELLED' && isSuperseded) {
      // "when a CANCELLED event arrives for a paypalInvoiceId that was deliberately replaced
      // (replacedAt set, or part of an instalment plan), do not mark our invoice CANCELLED
      // and do not raise an error; just log an audit event 'superseded invoice cancelled'."
      const auditEvt: AuditEvent = {
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: new Date().toISOString(),
        actor: 'paypal',
        kind: 'invoice.superseded_cancelled',
        summary: `Superseded invoice ${paypalInvoiceId} cancelled on PayPal; active invoice ${settleInvoice.id} preserved.`,
        invoiceId: settleInvoice.id,
        paypalRequestId: eventId,
        detail: { eventId, paypalInvoiceId },
      };

      await this.auditRepo.append(auditEvt);
      eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });
      return { handled: true, duplicate: false };
    }

    // For supported events, fetch live invoice status from PayPal and sync state
    const supportedEvents = [
      'INVOICING.INVOICE.PAID',
      'INVOICING.INVOICE.CANCELLED',
      'INVOICING.INVOICE.REFUNDED',
      'INVOICING.INVOICE.UPDATED',
    ];

    if (supportedEvents.some((prefix) => eventType.startsWith(prefix))) {
      await this.syncInvoiceState(settleInvoice.id, paypalInvoiceId, eventType, eventId);
    }

    return { handled: true, duplicate: false };
  }

  /**
   * Syncs invoice state from PayPal, updates DB, records audit event,
   * recomputes forecast, and emits SSE events.
   */
  async syncInvoiceState(
    invoiceId: Id,
    paypalInvoiceId: string,
    eventType: string,
    eventId?: string,
  ): Promise<void> {
    try {
      const { status: liveStatus, amountPaid: liveAmountPaid } =
        await this.paypalClient.getInvoice(paypalInvoiceId);

      const updatedInvoice = await this.invoiceRepo.update(invoiceId, {
        status: liveStatus,
        amountPaid: liveAmountPaid,
      });

      // Append audit event
      const auditEvt: AuditEvent = {
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: new Date().toISOString(),
        actor: 'paypal',
        kind: eventType,
        summary: `PayPal webhook ${eventType}: updated invoice ${updatedInvoice.number} status to ${liveStatus}, paid ${liveAmountPaid} cents.`,
        invoiceId: updatedInvoice.id,
        paypalRequestId: eventId,
        detail: { eventId, paypalInvoiceId, liveStatus, liveAmountPaid },
      };
      await this.auditRepo.append(auditEvt);

      // Recompute forecast with EnginePort
      const business = await this.businessRepo.get();
      const payers = await this.payerRepo.list();
      const allInvoices = await this.invoiceRepo.list();
      const obligations = await this.obligationRepo.list();

      if (business) {
        const engine = await getEngine();
        const receipts = engine.expectedReceipts(allInvoices, payers, business.asOf);
        const forecast = engine.forecast({
          business,
          obligations,
          receipts,
          horizonDays: 30,
        });

        // Emit SSE events
        eventBus.emitEvent({ type: 'invoice.updated', payload: updatedInvoice });
        eventBus.emitEvent({ type: 'audit.appended', payload: auditEvt });
        eventBus.emitEvent({ type: 'forecast.updated', payload: forecast });
      }
    } catch (err) {
      this.logger.error(
        { err, invoiceId, paypalInvoiceId },
        'Failed to sync invoice state after webhook',
      );
    }
  }
}

