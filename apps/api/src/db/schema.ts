import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  ActionParams,
  ActionStatus,
  ActionType,
  AuditActor,
  InvoiceStatus,
  ObligationKind,
  PayerPersona,
  PolicyVerdict,
  ScenarioComparison,
} from '@settle/shared';

// ── Businesses ────────────────────────────────────────────────────────────
export const businesses = pgTable('businesses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').$type<'USD'>().notNull(),
  asOf: text('as_of').notNull(), // 'YYYY-MM-DD'
  startingBalance: integer('starting_balance').notNull(),
  reserveThreshold: integer('reserve_threshold').notNull(),
});

// ── Payers ────────────────────────────────────────────────────────────────
export const payers = pgTable('payers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  persona: text('persona').$type<PayerPersona>().notNull(),
  avgDaysLate: doublePrecision('avg_days_late').notNull(),
  latenessRisk: doublePrecision('lateness_risk').notNull(),
});

// ── Invoices ──────────────────────────────────────────────────────────────
export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  payerId: text('payer_id')
    .notNull()
    .references(() => payers.id),
  number: text('number').notNull(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),
  amountPaid: integer('amount_paid').notNull(),
  issueDate: text('issue_date').notNull(),
  dueDate: text('due_date').notNull(),
  status: text('status').$type<InvoiceStatus>().notNull(),
  discountPct: doublePrecision('discount_pct').notNull().default(0),
  allowPartial: boolean('allow_partial').notNull().default(false),
  minimumAmountDue: integer('minimum_amount_due'),
  paypalInvoiceId: text('paypal_invoice_id'),
  payUrl: text('pay_url'),
});

// ── Obligations ───────────────────────────────────────────────────────────
export const obligations = pgTable('obligations', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  kind: text('kind').$type<ObligationKind>().notNull(),
  amount: integer('amount').notNull(),
  dueDate: text('due_date').notNull(),
});

// ── Policies ──────────────────────────────────────────────────────────────
export const policies = pgTable('policies', {
  id: text('id').primaryKey().default('default'),
  maxDiscountPct: doublePrecision('max_discount_pct').notNull(),
  maxInstalments: integer('max_instalments').notNull(),
  autoApproveMaxAmount: integer('auto_approve_max_amount').notNull(),
  requireApprovalFor: jsonb('require_approval_for')
    .$type<('OFFER_DISCOUNT' | 'OFFER_INSTALMENTS' | 'ESCALATE')[]>()
    .notNull(),
  quietHours: jsonb('quiet_hours').$type<{ startHour: number; endHour: number }>().notNull(),
  maxRemindersPerInvoicePerWeek: integer('max_reminders_per_invoice_per_week').notNull(),
});

// ── Action Records ────────────────────────────────────────────────────────
export const actionRecords = pgTable('action_records', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id),
  type: text('type').$type<ActionType>().notNull(),
  params: jsonb('params').$type<ActionParams>().notNull(),
  reason: text('reason').notNull(),
  simulation: jsonb('simulation').$type<ScenarioComparison>(),
  policy: jsonb('policy').$type<PolicyVerdict>().notNull(),
  status: text('status').$type<ActionStatus>().notNull(),
  createdAt: text('created_at').notNull(),
  decidedBy: text('decided_by').$type<'owner' | 'auto'>(),
  executedAt: text('executed_at'),
  paypalRequestId: text('paypal_request_id'),
  error: text('error'),
});

// ── Audit Events (APPEND ONLY) ────────────────────────────────────────────
export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  ts: text('ts').notNull(),
  actor: text('actor').$type<AuditActor>().notNull(),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  invoiceId: text('invoice_id'),
  actionId: text('action_id'),
  paypalRequestId: text('paypal_request_id'),
  detail: jsonb('detail'),
});

// ── PayPal Invoice IDs History ────────────────────────────────────────────
export const invoicePayPalIds = pgTable('invoice_paypal_ids', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id),
  paypalInvoiceId: text('paypal_invoice_id').notNull(),
  createdAt: text('created_at').notNull(),
  replacedAt: text('replaced_at'),
  reason: text('reason'),
});

// ── Processed Webhook Events (Deduplication) ──────────────────────────────
export const processedWebhookEvents = pgTable('processed_webhook_events', {
  id: text('id').primaryKey(), // PayPal event ID
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
});

