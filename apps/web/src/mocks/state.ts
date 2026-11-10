import type {
  Business,
  Payer,
  Invoice,
  Obligation,
  Policy,
  ActionRecord,
  AuditEvent,
  ForecastResult,
  Kpis,
  AgentRunResult,
  ChatAnswer,
  Snapshot,
} from '@settle/shared';
import { mockBusiness } from './fixtures/business';
import { mockPayers } from './fixtures/payers';
import { mockInvoices } from './fixtures/invoices';
import { mockObligations } from './fixtures/obligations';
import { mockPolicy } from './fixtures/policy';
import {
  baselineForecast,
  afterPaymentForecast,
} from './fixtures/forecast';
import { baselineKpis, afterPaymentKpis } from './fixtures/kpis';
import { baselineAuditEvents } from './fixtures/audit';
import { mockAgentActions } from './fixtures/actions';
import { cannedChatAnswers, fallbackChatAnswer } from './fixtures/chat';
import { generateDeterministicInvoices } from './fixtures/deterministicInvoices';
import { mockEventBus } from '../api/bus';
import type { DashboardResponse } from '../api/schemas';

export class MockStateMachine {
  business: Business = { ...mockBusiness };
  payers: Payer[] = mockPayers.map((p) => ({ ...p }));
  invoices: Invoice[] = mockInvoices.map((inv) => ({ ...inv }));
  obligations: Obligation[] = mockObligations.map((o) => ({ ...o }));
  policy: Policy = { ...mockPolicy };
  actions: ActionRecord[] = [];
  audit: AuditEvent[] = [...baselineAuditEvents];
  forecast: ForecastResult = { ...baselineForecast };
  kpis: Kpis = { ...baselineKpis };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.business = { ...mockBusiness };
    this.payers = mockPayers.map((p) => ({ ...p }));
    this.invoices = mockInvoices.map((inv) => ({ ...inv }));
    this.obligations = mockObligations.map((o) => ({ ...o }));
    this.policy = { ...mockPolicy };
    this.actions = [];
    this.audit = [...baselineAuditEvents];
    this.forecast = { ...baselineForecast };
    this.kpis = { ...baselineKpis };
  }

  getSnapshot(use200Invoices = false): Snapshot {
    return {
      business: this.business,
      payers: this.payers,
      invoices: use200Invoices ? generateDeterministicInvoices(200) : this.invoices,
      obligations: this.obligations,
      policy: this.policy,
    };
  }

  getDashboard(use200Invoices = false): DashboardResponse {
    return {
      business: this.business,
      kpis: this.kpis,
      forecast: this.forecast,
      invoices: use200Invoices ? generateDeterministicInvoices(200) : this.invoices,
      payers: this.payers,
      obligations: this.obligations,
      recentActions: this.actions.slice(0, 10),
      auditLog: this.audit.slice(0, 50),
      policy: this.policy,
    };
  }

  runAgent(): AgentRunResult {
    // Generate the 7 distinct status actions
    this.actions = mockAgentActions.map((a) => ({ ...a }));

    // Emit live events for all generated actions
    for (const action of this.actions) {
      mockEventBus.emit({
        type: 'action.updated',
        payload: action,
      });
    }

    const auditEvent: AuditEvent = {
      id: `aud_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'agent',
      kind: 'agent.cycle_completed',
      summary: 'Agent cycle evaluated 8 overdue invoices; generated 7 recovery actions (1 auto-approved, 1 awaiting approval, 1 skipped).',
    };
    this.audit = [auditEvent, ...this.audit];
    mockEventBus.emit({
      type: 'audit.appended',
      payload: auditEvent,
    });

    return {
      runId: `run_${Date.now()}`,
      actions: this.actions,
      skipped: [
        {
          invoiceId: 'inv_008',
          why: 'Legal dispute pending on invoice INV-1008',
        },
      ],
    };
  }

  approveAction(id: string, note?: string): ActionRecord {
    const actionIndex = this.actions.findIndex((a) => a.id === id);
    if (actionIndex === -1) {
      throw new Error(`Action not found: ${id}`);
    }

    const action = this.actions[actionIndex]!;
    const approvedAction: ActionRecord = {
      ...action,
      status: 'APPROVED',
      decidedBy: 'owner',
      params: {
        ...action.params,
        ...(note ? { note } : {}),
      },
    };
    this.actions[actionIndex] = approvedAction;

    mockEventBus.emit({
      type: 'action.updated',
      payload: approvedAction,
    });

    const approveAudit: AuditEvent = {
      id: `aud_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'owner',
      kind: 'action.approved',
      summary: `Owner approved ${action.type} for invoice ${action.invoiceId}${note ? ` (${note})` : ''}`,
      actionId: action.id,
      invoiceId: action.invoiceId,
    };
    this.audit = [approveAudit, ...this.audit];
    mockEventBus.emit({
      type: 'audit.appended',
      payload: approveAudit,
    });

    // Per spec: After ~1200ms transition to EXECUTED with paypalRequestId and executedAt
    setTimeout(() => {
      const currentIdx = this.actions.findIndex((a) => a.id === id);
      if (currentIdx !== -1) {
        const executedAction: ActionRecord = {
          ...this.actions[currentIdx]!,
          status: 'EXECUTED',
          executedAt: new Date().toISOString(),
          paypalRequestId: 'PP-REQ-7F3A91',
        };
        this.actions[currentIdx] = executedAction;

        mockEventBus.emit({
          type: 'action.updated',
          payload: executedAction,
        });

        const paypalAudit: AuditEvent = {
          id: `aud_${Date.now()}`,
          ts: new Date().toISOString(),
          actor: 'paypal',
          kind: 'action.executed',
          summary: `PayPal Invoicing API executed ${action.type} (Request: PP-REQ-7F3A91)`,
          actionId: action.id,
          invoiceId: action.invoiceId,
          paypalRequestId: 'PP-REQ-7F3A91',
        };
        this.audit = [paypalAudit, ...this.audit];
        mockEventBus.emit({
          type: 'audit.appended',
          payload: paypalAudit,
        });
      }
    }, 1200);

    return approvedAction;
  }

  rejectAction(id: string, note?: string): ActionRecord {
    const actionIndex = this.actions.findIndex((a) => a.id === id);
    if (actionIndex === -1) {
      throw new Error(`Action not found: ${id}`);
    }

    const action = this.actions[actionIndex]!;
    const rejectedAction: ActionRecord = {
      ...action,
      status: 'REJECTED',
      decidedBy: 'owner',
      params: {
        ...action.params,
        ...(note ? { note } : {}),
      },
    };
    this.actions[actionIndex] = rejectedAction;

    mockEventBus.emit({
      type: 'action.updated',
      payload: rejectedAction,
    });

    const rejectAudit: AuditEvent = {
      id: `aud_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'owner',
      kind: 'action.rejected',
      summary: `Owner rejected ${action.type} for invoice ${action.invoiceId}`,
      actionId: action.id,
      invoiceId: action.invoiceId,
    };
    this.audit = [rejectAudit, ...this.audit];
    mockEventBus.emit({
      type: 'audit.appended',
      payload: rejectAudit,
    });

    return rejectedAction;
  }

  retryAction(id: string): ActionRecord {
    const actionIndex = this.actions.findIndex((a) => a.id === id);
    if (actionIndex === -1) {
      throw new Error(`Action not found: ${id}`);
    }

    const action = this.actions[actionIndex]!;
    // Set to APPROVED briefly, then transition to EXECUTED after delay
    const retryingAction: ActionRecord = {
      ...action,
      status: 'APPROVED',
      error: undefined,
    };
    this.actions[actionIndex] = retryingAction;

    mockEventBus.emit({
      type: 'action.updated',
      payload: retryingAction,
    });

    setTimeout(() => {
      const idx = this.actions.findIndex((a) => a.id === id);
      if (idx !== -1) {
        const executedAction: ActionRecord = {
          ...this.actions[idx]!,
          status: 'EXECUTED',
          error: undefined,
          executedAt: new Date().toISOString(),
          paypalRequestId: 'PP-REQ-RETRY01',
        };
        this.actions[idx] = executedAction;

        mockEventBus.emit({
          type: 'action.updated',
          payload: executedAction,
        });

        const retryAudit: AuditEvent = {
          id: `aud_${Date.now()}`,
          ts: new Date().toISOString(),
          actor: 'paypal',
          kind: 'action.retry_succeeded',
          summary: `Retried action ${id} succeeded via PayPal gateway`,
          actionId: id,
          paypalRequestId: 'PP-REQ-RETRY01',
        };
        this.audit = [retryAudit, ...this.audit];
        mockEventBus.emit({
          type: 'audit.appended',
          payload: retryAudit,
        });
      }
    }, 800);

    return retryingAction;
  }

  simulatePayment(invoiceId: string): { status: string; invoice: Invoice; cashBalance: number } {
    const invIndex = this.invoices.findIndex((i) => i.id === invoiceId);
    if (invIndex === -1) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    const currentInv = this.invoices[invIndex]!;
    const delta = currentInv.amount - currentInv.amountPaid;

    const paidInvoice: Invoice = {
      ...currentInv,
      status: 'PAID',
      amountPaid: currentInv.amount,
    };
    this.invoices[invIndex] = paidInvoice;

    // Update starting liquid cash balance atomically
    this.business.startingBalance += delta;

    // Emit invoice update
    mockEventBus.emit({
      type: 'invoice.updated',
      payload: paidInvoice,
    });

    // Record audit event
    const auditEvent: AuditEvent = {
      id: `aud_${Date.now()}`,
      ts: new Date().toISOString(),
      actor: 'paypal',
      kind: 'invoice.payment_received',
      summary: `PayPal received settlement of $${(currentInv.amount / 100).toFixed(2)} for ${paidInvoice.number}`,
      invoiceId: paidInvoice.id,
      paypalRequestId: 'PP-WEBHOOK-SIM99',
    };
    this.audit = [auditEvent, ...this.audit];
    mockEventBus.emit({
      type: 'audit.appended',
      payload: auditEvent,
    });

    // Update forecast to afterPayment (breach eliminated)
    this.forecast = { ...afterPaymentForecast };
    mockEventBus.emit({
      type: 'forecast.updated',
      payload: this.forecast,
    });

    // Update KPIs
    this.kpis = { ...afterPaymentKpis, cash: this.business.startingBalance };

    return {
      status: 'ok',
      invoice: paidInvoice,
      cashBalance: this.business.startingBalance,
    };
  }

  updatePolicy(newPolicy: Policy): Policy {
    this.policy = { ...newPolicy };
    return this.policy;
  }

  chat(question: string): ChatAnswer {
    const canned = cannedChatAnswers[question];
    if (canned) {
      return canned;
    }
    return fallbackChatAnswer;
  }
}

export const mockState = new MockStateMachine();

