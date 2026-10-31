import { randomUUID } from 'node:crypto';
import type {
  Invoice,
  InvoiceStatus,
  Payer,
  PayPalPort,
  Cents,
  ISODate,
} from '@settle/shared';
import { PayPalAuthenticator } from './auth.js';
import { PayPalError, type PayPalErrorDetail } from './errors.js';
import { centsToPayPalString, payPalStringToCents } from './money.js';

export interface AuditRecord {
  operation: string;
  paypalRequestId: string;
  httpStatus: number;
  timestamp: string;
  debugId?: string;
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  authenticator?: PayPalAuthenticator;
}

export class PayPalClient implements PayPalPort {
  private readonly baseUrl: string;
  private readonly authenticator: PayPalAuthenticator;
  private readonly fetchFn: typeof fetch;
  private readonly auditTrail: AuditRecord[] = [];
  /** Maps original paypalInvoiceId -> new paypalInvoiceId when cancel-and-reissue fallback is triggered */
  private readonly reissuedMap: Map<string, string> = new Map();

  constructor(options: PayPalClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api-m.sandbox.paypal.com').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.authenticator =
      options.authenticator ??
      new PayPalAuthenticator({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        baseUrl: this.baseUrl,
        fetchFn: this.fetchFn,
      });
  }

  public getAuditTrail(): readonly AuditRecord[] {
    return [...this.auditTrail];
  }

  public getLastAuditRecord(): AuditRecord | undefined {
    return this.auditTrail[this.auditTrail.length - 1];
  }

  public getReissuedId(originalId: string): string {
    return this.reissuedMap.get(originalId) ?? originalId;
  }

  private recordAudit(record: AuditRecord): void {
    this.auditTrail.push(record);
  }

  private async request<T = unknown>(params: {
    method: string;
    path: string;
    body?: unknown;
    requestId?: string;
    operation: string;
  }): Promise<{ data: T; status: number; paypalRequestId: string; debugId?: string }> {
    const token = await this.authenticator.getAccessToken();
    const requestId = params.requestId ?? randomUUID();
    const url = `${this.baseUrl}${params.path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
      Prefer: 'return=representation',
    };

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: params.method,
        headers,
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      });
    } catch (networkErr) {
      throw new PayPalError({
        message: `Network error during ${params.operation}: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
        status: 500,
        paypalRequestId: requestId,
      });
    }

    const debugId = response.headers.get('paypal-debug-id') || undefined;
    this.recordAudit({
      operation: params.operation,
      paypalRequestId: requestId,
      httpStatus: response.status,
      timestamp: new Date().toISOString(),
      debugId,
    });

    if (!response.ok) {
      let errPayload: any;
      try {
        errPayload = await response.json();
      } catch {
        errPayload = { message: await response.text() };
      }

      const msg =
        errPayload.message ||
        errPayload.error_description ||
        `PayPal API error during ${params.operation} (HTTP ${response.status})`;

      throw new PayPalError({
        message: msg,
        status: response.status,
        debugId,
        paypalRequestId: requestId,
        details: errPayload.details as PayPalErrorDetail[],
        rawError: errPayload,
      });
    }

    if (response.status === 204) {
      return { data: {} as T, status: response.status, paypalRequestId: requestId, debugId };
    }

    const data = (await response.json()) as T;
    return { data, status: response.status, paypalRequestId: requestId, debugId };
  }

  /**
   * Generates next invoice number from PayPal.
   */
  public async generateNextInvoiceNumber(): Promise<string> {
    const { data } = await this.request<{ invoice_number: string }>({
      method: 'POST',
      path: '/v2/invoicing/generate-next-invoice-number',
      operation: 'generateNextInvoiceNumber',
    });
    return data.invoice_number;
  }

  /**
   * Create draft invoice, send it to payer, and return paypalInvoiceId and payment link.
   */
  public async createAndSendInvoice(
    inv: Invoice,
    payer: Payer,
  ): Promise<{ paypalInvoiceId: string; payUrl: string }> {
    const invoiceNumber = inv.number || (await this.generateNextInvoiceNumber());
    const today = new Date().toISOString().slice(0, 10);
    // Use invoice issueDate if not in future, otherwise use today to avoid SCHEDULED status
    const invoiceDate = inv.issueDate && inv.issueDate <= today ? inv.issueDate : today;

    const remainingAmount = inv.amount - inv.amountPaid;
    const itemAmountStr = centsToPayPalString(remainingAmount > 0 ? remainingAmount : inv.amount);

    const draftPayload: any = {
      detail: {
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        currency_code: 'USD',
        payment_term: {
          term_type: 'DUE_ON_DATE_SPECIFIED',
          due_date: inv.dueDate,
        },
      },
      primary_recipients: [
        {
          billing_info: {
            name: {
              given_name: payer.name,
            },
            email_address: payer.email,
          },
        },
      ],
      items: [
        {
          name: inv.description || 'Invoice Services',
          quantity: '1',
          unit_amount: {
            currency_code: 'USD',
            value: itemAmountStr,
          },
        },
      ],
      configuration: {
        allow_tip: false,
      },
    };

    if (inv.discountPct > 0) {
      const discountCents = Math.round((remainingAmount * inv.discountPct) / 100);
      const finalAmountCents = remainingAmount - discountCents;
      draftPayload.amount = {
        breakdown: {
          item_total: {
            currency_code: 'USD',
            value: itemAmountStr,
          },
          discount: {
            invoice_discount: {
              percent: String(inv.discountPct),
              amount: {
                currency_code: 'USD',
                value: centsToPayPalString(discountCents),
              },
            },
          },
        },
        currency_code: 'USD',
        value: centsToPayPalString(finalAmountCents),
      };
    }

    // 1. Create draft
    const { data: draftData } = await this.request<any>({
      method: 'POST',
      path: '/v2/invoicing/invoices',
      body: draftPayload,
      operation: 'createDraftInvoice',
    });

    const paypalInvoiceId = draftData.id;
    if (!paypalInvoiceId) {
      throw new PayPalError({
        message: 'Draft invoice response missing ID',
        status: 500,
      });
    }

    // 2. Send invoice
    const { data: sendData } = await this.request<any>({
      method: 'POST',
      path: `/v2/invoicing/invoices/${paypalInvoiceId}/send`,
      body: { send_to_recipient: true },
      operation: 'sendInvoice',
    });

    const payUrl =
      sendData?.href ||
      draftData?.detail?.metadata?.recipient_view_url ||
      this.generatePayLink(paypalInvoiceId);

    return { paypalInvoiceId, payUrl };
  }

  /**
   * Sends a payment reminder for a SENT invoice.
   */
  public async sendReminder(paypalInvoiceId: string, note: string): Promise<void> {
    const targetId = this.getReissuedId(paypalInvoiceId);
    await this.request({
      method: 'POST',
      path: `/v2/invoicing/invoices/${targetId}/remind`,
      body: {
        subject: 'Invoice Payment Reminder',
        note: note || 'Please find your overdue invoice attached.',
        send_to_recipient: true,
      },
      operation: 'sendReminder',
    });
  }

  /**
   * Updates an invoice (discount percent, due date, partial payment).
   * Attempts direct PUT update first; if rejected by PayPal on a SENT invoice,
   * falls back to cancel-and-reissue, maintaining mapping of IDs.
   */
  public async updateInvoice(
    paypalInvoiceId: string,
    patch: {
      discountPct?: number;
      dueDate?: ISODate;
      allowPartial?: boolean;
      minimumAmountDue?: Cents;
    },
  ): Promise<void> {
    const targetId = this.getReissuedId(paypalInvoiceId);

    // Fetch current invoice representation
    const { data: currentInv } = await this.request<any>({
      method: 'GET',
      path: `/v2/invoicing/invoices/${targetId}`,
      operation: 'getInvoiceForUpdate',
    });

    const updatedInv = JSON.parse(JSON.stringify(currentInv));

    if (patch.dueDate) {
      if (!updatedInv.detail) updatedInv.detail = {};
      if (!updatedInv.detail.payment_term) updatedInv.detail.payment_term = {};
      updatedInv.detail.payment_term.due_date = patch.dueDate;
    }

    // Calculate discount update
    if (patch.discountPct !== undefined && patch.discountPct > 0) {
      const itemTotalStr =
        updatedInv.amount?.breakdown?.item_total?.value ||
        updatedInv.items?.[0]?.unit_amount?.value ||
        updatedInv.amount?.value ||
        '0.00';
      const itemTotalCents = payPalStringToCents(itemTotalStr);
      const discountCents = Math.round((itemTotalCents * patch.discountPct) / 100);
      const finalCents = itemTotalCents - discountCents;

      if (!updatedInv.amount) updatedInv.amount = {};
      if (!updatedInv.amount.breakdown) updatedInv.amount.breakdown = {};
      updatedInv.amount.breakdown.item_total = {
        currency_code: 'USD',
        value: itemTotalStr,
      };
      updatedInv.amount.breakdown.discount = {
        invoice_discount: {
          percent: String(patch.discountPct),
          amount: {
            currency_code: 'USD',
            value: centsToPayPalString(discountCents),
          },
        },
      };
      updatedInv.amount.value = centsToPayPalString(finalCents);
      delete updatedInv.due_amount; // Let PayPal calculate
    }

    if (patch.allowPartial !== undefined) {
      if (!updatedInv.configuration) updatedInv.configuration = {};
      updatedInv.configuration.partial_payment = {
        allow_partial_payment: patch.allowPartial,
        minimum_amount_due:
          patch.minimumAmountDue !== undefined
            ? {
                currency_code: 'USD',
                value: centsToPayPalString(patch.minimumAmountDue),
              }
            : undefined,
      };
    }

    // Attempt direct PUT update
    try {
      await this.request({
        method: 'PUT',
        path: `/v2/invoicing/invoices/${targetId}`,
        body: updatedInv,
        operation: 'putUpdateInvoice',
      });
      return;
    } catch (putErr) {
      // If direct PUT fails, execute the cancel-and-reissue fallback
      await this.cancelAndReissue(targetId, currentInv, patch);
    }
  }

  /**
   * Fallback strategy: cancels existing invoice and creates a new one with updated terms.
   */
  private async cancelAndReissue(
    oldInvoiceId: string,
    currentInv: any,
    patch: {
      discountPct?: number;
      dueDate?: ISODate;
      allowPartial?: boolean;
      minimumAmountDue?: Cents;
    },
  ): Promise<string> {
    // 1. Cancel existing invoice if it's SENT
    try {
      await this.request({
        method: 'POST',
        path: `/v2/invoicing/invoices/${oldInvoiceId}/cancel`,
        body: {
          subject: 'Invoice Cancelled and Reissued',
          note: 'This invoice has been cancelled and reissued with updated terms.',
          send_to_recipient: true,
        },
        operation: 'cancelInvoiceForReissue',
      });
    } catch (cancelErr) {
      // If cannot cancel (e.g. DRAFT or SCHEDULED), try delete or ignore
      if (currentInv.status === 'DRAFT') {
        try {
          await this.request({
            method: 'DELETE',
            path: `/v2/invoicing/invoices/${oldInvoiceId}`,
            operation: 'deleteDraftForReissue',
          });
        } catch {
          // ignore
        }
      }
    }

    // 2. Generate new invoice number
    const newNumber = await this.generateNextInvoiceNumber();

    // 3. Build new invoice payload
    const today = new Date().toISOString().slice(0, 10);
    const itemTotalStr =
      currentInv.amount?.breakdown?.item_total?.value ||
      currentInv.items?.[0]?.unit_amount?.value ||
      '100.00';
    const itemTotalCents = payPalStringToCents(itemTotalStr);
    const discountPct = patch.discountPct ?? 0;
    const discountCents = Math.round((itemTotalCents * discountPct) / 100);
    const finalCents = itemTotalCents - discountCents;

    const newDraft: any = {
      detail: {
        invoice_number: newNumber,
        invoice_date: today,
        currency_code: 'USD',
        payment_term: {
          term_type: 'DUE_ON_DATE_SPECIFIED',
          due_date: patch.dueDate || currentInv.detail?.payment_term?.due_date || today,
        },
        note: `Reissued from ${currentInv.detail?.invoice_number || oldInvoiceId}`,
      },
      primary_recipients: currentInv.primary_recipients || [
        {
          billing_info: {
            name: { given_name: 'Payer' },
            email_address: 'payer@example.com',
          },
        },
      ],
      items: currentInv.items || [
        {
          name: 'Services',
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: itemTotalStr },
        },
      ],
      configuration: {
        allow_tip: false,
      },
    };

    if (discountPct > 0) {
      newDraft.amount = {
        breakdown: {
          item_total: { currency_code: 'USD', value: itemTotalStr },
          discount: {
            invoice_discount: {
              percent: String(discountPct),
              amount: { currency_code: 'USD', value: centsToPayPalString(discountCents) },
            },
          },
        },
        currency_code: 'USD',
        value: centsToPayPalString(finalCents),
      };
    }

    // 4. Create and send new invoice
    const { data: created } = await this.request<any>({
      method: 'POST',
      path: '/v2/invoicing/invoices',
      body: newDraft,
      operation: 'createReissuedDraft',
    });

    const newInvoiceId = created.id;
    await this.request({
      method: 'POST',
      path: `/v2/invoicing/invoices/${newInvoiceId}/send`,
      body: { send_to_recipient: true },
      operation: 'sendReissuedInvoice',
    });

    // Map old invoice ID to new invoice ID
    this.reissuedMap.set(oldInvoiceId, newInvoiceId);
    return newInvoiceId;
  }

  /**
   * Retrieves an invoice from PayPal and maps to our InvoiceStatus and amountPaid in cents.
   */
  public async getInvoice(
    paypalInvoiceId: string,
  ): Promise<{ status: InvoiceStatus; amountPaid: Cents }> {
    const targetId = this.getReissuedId(paypalInvoiceId);
    const { data: invoice } = await this.request<any>({
      method: 'GET',
      path: `/v2/invoicing/invoices/${targetId}`,
      operation: 'getInvoice',
    });

    const status = this.mapStatus(invoice.status);
    const paidAmountStr = invoice.payments?.paid_amount?.value ?? '0.00';
    const amountPaid = payPalStringToCents(paidAmountStr);

    return { status, amountPaid };
  }

  /**
   * Records an external payment against an invoice (demo helper).
   */
  public async recordExternalPayment(
    paypalInvoiceId: string,
    amountCents: Cents,
    note = 'Payment recorded via Settle demo',
  ): Promise<{ paymentId: string; httpStatus: number; paypalRequestId: string }> {
    const targetId = this.getReissuedId(paypalInvoiceId);
    const today = new Date().toISOString().slice(0, 10);
    const value = centsToPayPalString(amountCents);

    const { data, status, paypalRequestId } = await this.request<any>({
      method: 'POST',
      path: `/v2/invoicing/invoices/${targetId}/payments`,
      body: {
        method: 'OTHER',
        payment_date: today,
        amount: {
          currency_code: 'USD',
          value,
        },
        note,
      },
      operation: 'recordExternalPayment',
    });

    return {
      paymentId: data?.payment_id || 'manual_payment',
      httpStatus: status,
      paypalRequestId,
    };
  }

  /**
   * Generates payer-facing payment link for an invoice.
   */
  public generatePayLink(paypalInvoiceId: string): string {
    const targetId = this.getReissuedId(paypalInvoiceId);
    return `https://www.sandbox.paypal.com/invoice/p/#${targetId}`;
  }

  /**
   * Lists webhook deliveries/events if configured.
   */
  public async listWebhookDeliveries(webhookId?: string): Promise<any> {
    if (webhookId) {
      try {
        const { data } = await this.request({
          method: 'GET',
          path: `/v1/notifications/webhooks/${webhookId}`,
          operation: 'getWebhookDetails',
        });
        return data;
      } catch {
        // Fallback to webhook events
      }
    }

    const { data } = await this.request({
      method: 'GET',
      path: '/v1/notifications/webhooks-events?page_size=5',
      operation: 'listWebhookEvents',
    });
    return data;
  }

  /**
   * Maps PayPal invoice status to our domain InvoiceStatus.
   */
  private mapStatus(paypalStatus: string): InvoiceStatus {
    switch (paypalStatus?.toUpperCase()) {
      case 'DRAFT':
        return 'DRAFT';
      case 'SENT':
      case 'SCHEDULED':
      case 'UNPAID':
        return 'SENT';
      case 'PARTIALLY_PAID':
        return 'PARTIALLY_PAID';
      case 'PAID':
      case 'MARKED_AS_PAID':
        return 'PAID';
      case 'CANCELLED':
      case 'VOIDED':
        return 'CANCELLED';
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return 'REFUNDED';
      default:
        return 'SENT';
    }
  }
}
