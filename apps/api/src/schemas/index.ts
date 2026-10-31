import { z } from 'zod';
import type * as T from '@settle/shared';

// Type assertion helpers: checks two-way type compatibility at compile time
type AssertAssignable<TTarget, TActual extends TTarget> = TActual;
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// ── Base Schemas ──────────────────────────────────────────────────────────
export const CentsSchema = z.number().int();
export const ISODateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const IdSchema = z.string().min(1);

// ── Business ──────────────────────────────────────────────────────────────
export const BusinessSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  currency: z.literal('USD'),
  asOf: ISODateSchema,
  startingBalance: CentsSchema,
  reserveThreshold: CentsSchema,
});
export type BusinessType = z.infer<typeof BusinessSchema>;
type _CheckBusiness = AssertExact<BusinessType, T.Business>;

// ── Payer ─────────────────────────────────────────────────────────────────
export const PayerPersonaSchema = z.enum(['reliable', 'slow', 'chronic', 'ghost']);
export type PayerPersonaType = z.infer<typeof PayerPersonaSchema>;
type _CheckPayerPersona = AssertExact<PayerPersonaType, T.PayerPersona>;

export const PayerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  email: z.string().email(),
  persona: PayerPersonaSchema,
  avgDaysLate: z.number(),
  latenessRisk: z.number().min(0).max(1),
});
export type PayerType = z.infer<typeof PayerSchema>;
type _CheckPayer = AssertExact<PayerType, T.Payer>;

// ── Invoice ───────────────────────────────────────────────────────────────
export const InvoiceStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
]);
export type InvoiceStatusType = z.infer<typeof InvoiceStatusSchema>;
type _CheckInvoiceStatus = AssertExact<InvoiceStatusType, T.InvoiceStatus>;

export const InvoiceSchema = z.object({
  id: IdSchema,
  payerId: IdSchema,
  number: z.string().min(1),
  description: z.string(),
  amount: CentsSchema,
  amountPaid: CentsSchema,
  issueDate: ISODateSchema,
  dueDate: ISODateSchema,
  status: InvoiceStatusSchema,
  discountPct: z.number(),
  allowPartial: z.boolean(),
  minimumAmountDue: CentsSchema.optional(),
  paypalInvoiceId: z.string().optional(),
  payUrl: z.string().optional(),
});
export type InvoiceType = z.infer<typeof InvoiceSchema>;
type _CheckInvoice = AssertExact<InvoiceType, T.Invoice>;

// ── Obligation ────────────────────────────────────────────────────────────
export const ObligationKindSchema = z.enum(['payroll', 'rent', 'tax', 'supplier', 'other']);
export type ObligationKindType = z.infer<typeof ObligationKindSchema>;
type _CheckObligationKind = AssertExact<ObligationKindType, T.ObligationKind>;

export const ObligationSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  kind: ObligationKindSchema,
  amount: CentsSchema,
  dueDate: ISODateSchema,
});
export type ObligationType = z.infer<typeof ObligationSchema>;
type _CheckObligation = AssertExact<ObligationType, T.Obligation>;

// ── ExpectedReceipt ───────────────────────────────────────────────────────
export const ConfidenceSchema = z.enum(['confirmed', 'expected', 'uncertain']);
export type ConfidenceType = z.infer<typeof ConfidenceSchema>;
type _CheckConfidence = AssertExact<ConfidenceType, T.Confidence>;

export const ExpectedReceiptSchema = z.object({
  invoiceId: IdSchema,
  amount: CentsSchema,
  date: ISODateSchema,
  confidence: ConfidenceSchema,
});
export type ExpectedReceiptType = z.infer<typeof ExpectedReceiptSchema>;
type _CheckExpectedReceipt = AssertExact<ExpectedReceiptType, T.ExpectedReceipt>;

// ── Forecast ──────────────────────────────────────────────────────────────
export const ForecastInputSchema = z.object({
  business: BusinessSchema,
  obligations: z.array(ObligationSchema),
  receipts: z.array(ExpectedReceiptSchema),
  horizonDays: z.number().int().default(30),
  includeUncertain: z.boolean().optional(),
});
export type ForecastInputType = z.infer<typeof ForecastInputSchema>;
type _CheckForecastInput = AssertExact<ForecastInputType, T.ForecastInput>;

export const DayBalanceSchema = z.object({
  date: ISODateSchema,
  receipts: CentsSchema,
  outflows: CentsSchema,
  closing: CentsSchema,
  belowReserve: z.boolean(),
});
export type DayBalanceType = z.infer<typeof DayBalanceSchema>;
type _CheckDayBalance = AssertExact<DayBalanceType, T.DayBalance>;

export const ForecastResultSchema = z.object({
  days: z.array(DayBalanceSchema),
  lowest: z.object({
    date: ISODateSchema,
    amount: CentsSchema,
  }),
  firstBreachDate: ISODateSchema.nullable(),
  shortfall: CentsSchema,
});
export type ForecastResultType = z.infer<typeof ForecastResultSchema>;
type _CheckForecastResult = AssertExact<ForecastResultType, T.ForecastResult>;

// ── Scenario ──────────────────────────────────────────────────────────────
export const ScenarioChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REMIND'),
    invoiceId: IdSchema,
    newExpectedDate: ISODateSchema,
  }),
  z.object({
    type: z.literal('OFFER_DISCOUNT'),
    invoiceId: IdSchema,
    discountPct: z.number(),
    newExpectedDate: ISODateSchema,
  }),
  z.object({
    type: z.literal('OFFER_INSTALMENTS'),
    invoiceId: IdSchema,
    count: z.number().int(),
    spacingDays: z.number().int(),
    firstDate: ISODateSchema,
  }),
  z.object({
    type: z.literal('PURCHASE'),
    label: z.string(),
    amount: CentsSchema,
    date: ISODateSchema,
  }),
]);
export type ScenarioChangeType = z.infer<typeof ScenarioChangeSchema>;
type _CheckScenarioChange = AssertExact<ScenarioChangeType, T.ScenarioChange>;

export const ScenarioComparisonSchema = z.object({
  change: ScenarioChangeSchema,
  baseline: ForecastResultSchema,
  scenario: ForecastResultSchema,
  lowestDelta: CentsSchema,
  shortfallDelta: CentsSchema,
  cashCost: CentsSchema,
  closesGap: z.boolean(),
  assumptions: z.array(z.string()),
});
export type ScenarioComparisonType = z.infer<typeof ScenarioComparisonSchema>;
type _CheckScenarioComparison = AssertExact<ScenarioComparisonType, T.ScenarioComparison>;

export const KpisSchema = z.object({
  cash: CentsSchema,
  overdueTotal: CentsSchema,
  overdueCount: z.number().int(),
  avgDaysLate: z.number(),
  lowest: z.object({
    date: ISODateSchema,
    amount: CentsSchema,
  }),
  shortfall: CentsSchema,
  nextObligation: ObligationSchema.optional(),
});
export type KpisType = z.infer<typeof KpisSchema>;
type _CheckKpis = AssertExact<KpisType, T.Kpis>;

// ── Policy ────────────────────────────────────────────────────────────────
export const PolicySchema = z.object({
  maxDiscountPct: z.number(),
  maxInstalments: z.number().int(),
  autoApproveMaxAmount: CentsSchema,
  requireApprovalFor: z.array(z.enum(['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'])),
  quietHours: z.object({
    startHour: z.number().int(),
    endHour: z.number().int(),
  }),
  maxRemindersPerInvoicePerWeek: z.number().int(),
});
export type PolicyType = z.infer<typeof PolicySchema>;
type _CheckPolicy = AssertExact<PolicyType, T.Policy>;

export const PolicyVerdictSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
  violations: z.array(z.string()),
});
export type PolicyVerdictType = z.infer<typeof PolicyVerdictSchema>;
type _CheckPolicyVerdict = AssertExact<PolicyVerdictType, T.PolicyVerdict>;

// ── Actions and Audit ─────────────────────────────────────────────────────
export const ActionTypeSchema = z.enum([
  'REMIND',
  'OFFER_DISCOUNT',
  'OFFER_INSTALMENTS',
  'ESCALATE',
  'NO_ACTION',
]);
export type ActionTypeType = z.infer<typeof ActionTypeSchema>;
type _CheckActionType = AssertExact<ActionTypeType, T.ActionType>;

export const ActionStatusSchema = z.enum([
  'PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTED',
  'REJECTED',
  'BLOCKED',
  'FAILED',
]);
export type ActionStatusType = z.infer<typeof ActionStatusSchema>;
type _CheckActionStatus = AssertExact<ActionStatusType, T.ActionStatus>;

export const ActionParamsSchema = z.object({
  discountPct: z.number().optional(),
  instalments: z
    .object({
      count: z.number().int(),
      spacingDays: z.number().int(),
    })
    .optional(),
  note: z.string().optional(),
});
export type ActionParamsType = z.infer<typeof ActionParamsSchema>;
type _CheckActionParams = AssertExact<ActionParamsType, T.ActionParams>;

export const ActionRecordSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  type: ActionTypeSchema,
  params: ActionParamsSchema,
  reason: z.string(),
  simulation: ScenarioComparisonSchema.optional(),
  policy: PolicyVerdictSchema,
  status: ActionStatusSchema,
  createdAt: z.string(),
  decidedBy: z.enum(['owner', 'auto']).optional(),
  executedAt: z.string().optional(),
  paypalRequestId: z.string().optional(),
  error: z.string().optional(),
});
export type ActionRecordType = z.infer<typeof ActionRecordSchema>;
type _CheckActionRecord = AssertExact<ActionRecordType, T.ActionRecord>;

export const AuditActorSchema = z.enum(['agent', 'owner', 'paypal', 'system']);
export type AuditActorType = z.infer<typeof AuditActorSchema>;
type _CheckAuditActor = AssertExact<AuditActorType, T.AuditActor>;

export const AuditEventSchema = z.object({
  id: IdSchema,
  ts: z.string(),
  actor: AuditActorSchema,
  kind: z.string(),
  summary: z.string(),
  invoiceId: IdSchema.optional(),
  actionId: IdSchema.optional(),
  paypalRequestId: z.string().optional(),
  detail: z.unknown().optional(),
});
export type AuditEventType = z.infer<typeof AuditEventSchema>;
type _CheckAuditEvent = AssertExact<AuditEventType, T.AuditEvent>;

// ── Agent ─────────────────────────────────────────────────────────────────
export const AgentRunResultSchema = z.object({
  runId: IdSchema,
  actions: z.array(ActionRecordSchema),
  skipped: z.array(
    z.object({
      invoiceId: IdSchema,
      why: z.string(),
    }),
  ),
});
export type AgentRunResultType = z.infer<typeof AgentRunResultSchema>;
type _CheckAgentRunResult = AssertExact<AgentRunResultType, T.AgentRunResult>;

export const ChatAnswerSchema = z.object({
  text: z.string(),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      args: z.unknown(),
      result: z.unknown(),
    }),
  ),
  comparison: ScenarioComparisonSchema.optional(),
  forecast: ForecastResultSchema.optional(),
});
export type ChatAnswerType = z.infer<typeof ChatAnswerSchema>;
type _CheckChatAnswer = AssertExact<ChatAnswerType, T.ChatAnswer>;

// ── Snapshot and Live Events ──────────────────────────────────────────────
export const SnapshotSchema = z.object({
  business: BusinessSchema,
  payers: z.array(PayerSchema),
  invoices: z.array(InvoiceSchema),
  obligations: z.array(ObligationSchema),
  policy: PolicySchema,
});
export type SnapshotType = z.infer<typeof SnapshotSchema>;
type _CheckSnapshot = AssertExact<SnapshotType, T.Snapshot>;

export const SseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invoice.updated'), payload: InvoiceSchema }),
  z.object({ type: z.literal('action.updated'), payload: ActionRecordSchema }),
  z.object({ type: z.literal('audit.appended'), payload: AuditEventSchema }),
  z.object({ type: z.literal('forecast.updated'), payload: ForecastResultSchema }),
]);
export type SseEventType = z.infer<typeof SseEventSchema>;
type _CheckSseEvent = AssertExact<SseEventType, T.SseEvent>;

// ── Dashboard Endpoint Response Schema ────────────────────────────────────
export const DashboardResponseSchema = z.object({
  business: BusinessSchema,
  kpis: KpisSchema,
  forecast: ForecastResultSchema,
  overdueInvoices: z.array(InvoiceSchema),
  obligations: z.array(ObligationSchema),
  recentActions: z.array(ActionRecordSchema),
  auditLog: z.array(AuditEventSchema),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// ── Request Body Schemas ──────────────────────────────────────────────────
export const SimulateRequestBodySchema = z.object({
  change: ScenarioChangeSchema,
});

export const ChatRequestBodySchema = z.object({
  question: z.string().min(1, 'Question cannot be empty'),
});

export const ActionDecisionBodySchema = z.object({
  note: z.string().optional(),
});

export const UpdatePolicyBodySchema = PolicySchema;

// ── Error Response Schema ─────────────────────────────────────────────────
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

