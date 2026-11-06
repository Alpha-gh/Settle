import { z } from 'zod';
import type {
  Business,
  Payer,
  Invoice,
  Obligation,
  Policy,
  PolicyVerdict,
  ActionRecord,
  ScenarioComparison,
  ScenarioChange,
  ForecastResult,
  DayBalance,
  Kpis,
  AuditEvent,
  AgentRunResult,
  ChatAnswer,
  Snapshot,
  SseEvent,
} from '@settle/shared';

/**
 * Type helper for bidirectional type equality assertion at compile time.
 * If either type has extra, missing, or mismatched properties, it resolves to false.
 */
export type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// 1. Business
export const businessSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.literal('USD'),
  asOf: z.string(),
  startingBalance: z.number().int(),
  reserveThreshold: z.number().int(),
}) satisfies z.ZodType<Business>;

const _assertBusiness: AssertEqual<z.infer<typeof businessSchema>, Business> = true;

// 2. Payer
export const payerPersonaSchema = z.enum(['reliable', 'slow', 'chronic', 'ghost']);

export const payerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  persona: payerPersonaSchema,
  avgDaysLate: z.number(),
  latenessRisk: z.number(),
}) satisfies z.ZodType<Payer>;

const _assertPayer: AssertEqual<z.infer<typeof payerSchema>, Payer> = true;

// 3. Invoice
export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
]);

export const invoiceSchema = z.object({
  id: z.string(),
  payerId: z.string(),
  number: z.string(),
  description: z.string(),
  amount: z.number().int(),
  amountPaid: z.number().int(),
  issueDate: z.string(),
  dueDate: z.string(),
  status: invoiceStatusSchema,
  discountPct: z.number(),
  allowPartial: z.boolean(),
  minimumAmountDue: z.number().int().optional(),
  paypalInvoiceId: z.string().optional(),
  payUrl: z.string().optional(),
}) satisfies z.ZodType<Invoice>;

const _assertInvoice: AssertEqual<z.infer<typeof invoiceSchema>, Invoice> = true;

// 4. Obligation
export const obligationKindSchema = z.enum(['payroll', 'rent', 'tax', 'supplier', 'other']);

export const obligationSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: obligationKindSchema,
  amount: z.number().int(),
  dueDate: z.string(),
}) satisfies z.ZodType<Obligation>;

const _assertObligation: AssertEqual<z.infer<typeof obligationSchema>, Obligation> = true;

// 5. Policy
export const policySchema = z.object({
  maxDiscountPct: z.number(),
  maxInstalments: z.number().int(),
  autoApproveMaxAmount: z.number().int(),
  requireApprovalFor: z.array(z.enum(['OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'ESCALATE'])),
  quietHours: z.object({
    startHour: z.number().int(),
    endHour: z.number().int(),
  }),
  maxRemindersPerInvoicePerWeek: z.number().int(),
}) satisfies z.ZodType<Policy>;

const _assertPolicy: AssertEqual<z.infer<typeof policySchema>, Policy> = true;

// 6. PolicyVerdict
export const policyVerdictSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
  violations: z.array(z.string()),
}) satisfies z.ZodType<PolicyVerdict>;

const _assertPolicyVerdict: AssertEqual<z.infer<typeof policyVerdictSchema>, PolicyVerdict> = true;

// DayBalance & ForecastResult (needed for ScenarioComparison)
export const dayBalanceSchema = z.object({
  date: z.string(),
  receipts: z.number().int(),
  outflows: z.number().int(),
  closing: z.number().int(),
  belowReserve: z.boolean(),
}) satisfies z.ZodType<DayBalance>;

const _assertDayBalance: AssertEqual<z.infer<typeof dayBalanceSchema>, DayBalance> = true;

export const forecastResultSchema = z.object({
  days: z.array(dayBalanceSchema),
  lowest: z.object({
    date: z.string(),
    amount: z.number().int(),
  }),
  firstBreachDate: z.string().nullable(),
  shortfall: z.number().int(),
}) satisfies z.ZodType<ForecastResult>;

const _assertForecastResult: AssertEqual<z.infer<typeof forecastResultSchema>, ForecastResult> = true;

// ScenarioChange
export const scenarioChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REMIND'),
    invoiceId: z.string(),
    newExpectedDate: z.string(),
  }),
  z.object({
    type: z.literal('OFFER_DISCOUNT'),
    invoiceId: z.string(),
    discountPct: z.number(),
    newExpectedDate: z.string(),
  }),
  z.object({
    type: z.literal('OFFER_INSTALMENTS'),
    invoiceId: z.string(),
    count: z.number().int(),
    spacingDays: z.number().int(),
    firstDate: z.string(),
  }),
  z.object({
    type: z.literal('PURCHASE'),
    label: z.string(),
    amount: z.number().int(),
    date: z.string(),
  }),
]) satisfies z.ZodType<ScenarioChange>;

const _assertScenarioChange: AssertEqual<z.infer<typeof scenarioChangeSchema>, ScenarioChange> = true;

// 7. ScenarioComparison
export const scenarioComparisonSchema = z.object({
  change: scenarioChangeSchema,
  baseline: forecastResultSchema,
  scenario: forecastResultSchema,
  lowestDelta: z.number().int(),
  shortfallDelta: z.number().int(),
  cashCost: z.number().int(),
  closesGap: z.boolean(),
  assumptions: z.array(z.string()),
}) satisfies z.ZodType<ScenarioComparison>;

const _assertScenarioComparison: AssertEqual<z.infer<typeof scenarioComparisonSchema>, ScenarioComparison> = true;

// 8. ActionRecord
export const actionTypeSchema = z.enum([
  'REMIND',
  'OFFER_DISCOUNT',
  'OFFER_INSTALMENTS',
  'ESCALATE',
  'NO_ACTION',
]);

export const actionStatusSchema = z.enum([
  'PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTED',
  'REJECTED',
  'BLOCKED',
  'FAILED',
]);

export const actionParamsSchema = z.object({
  discountPct: z.number().optional(),
  instalments: z
    .object({
      count: z.number().int(),
      spacingDays: z.number().int(),
    })
    .optional(),
  note: z.string().optional(),
});

export const actionRecordSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  type: actionTypeSchema,
  params: actionParamsSchema,
  reason: z.string(),
  simulation: scenarioComparisonSchema.optional(),
  policy: policyVerdictSchema,
  status: actionStatusSchema,
  createdAt: z.string(),
  decidedBy: z.enum(['owner', 'auto']).optional(),
  executedAt: z.string().optional(),
  paypalRequestId: z.string().optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<ActionRecord>;

const _assertActionRecord: AssertEqual<z.infer<typeof actionRecordSchema>, ActionRecord> = true;

// 9. Kpis
export const kpisSchema = z.object({
  cash: z.number().int(),
  overdueTotal: z.number().int(),
  overdueCount: z.number().int(),
  avgDaysLate: z.number(),
  lowest: z.object({
    date: z.string(),
    amount: z.number().int(),
  }),
  shortfall: z.number().int(),
  nextObligation: obligationSchema.optional(),
}) satisfies z.ZodType<Kpis>;

const _assertKpis: AssertEqual<z.infer<typeof kpisSchema>, Kpis> = true;

// 10. AuditEvent
export const auditActorSchema = z.enum(['agent', 'owner', 'paypal', 'system']);

export const auditEventSchema = z.object({
  id: z.string(),
  ts: z.string(),
  actor: auditActorSchema,
  kind: z.string(),
  summary: z.string(),
  invoiceId: z.string().optional(),
  actionId: z.string().optional(),
  paypalRequestId: z.string().optional(),
  detail: z.unknown().optional(),
}) satisfies z.ZodType<AuditEvent>;

const _assertAuditEvent: AssertEqual<z.infer<typeof auditEventSchema>, AuditEvent> = true;

// 11. AgentRunResult
export const agentRunResultSchema = z.object({
  runId: z.string(),
  actions: z.array(actionRecordSchema),
  skipped: z.array(
    z.object({
      invoiceId: z.string(),
      why: z.string(),
    }),
  ),
}) satisfies z.ZodType<AgentRunResult>;

const _assertAgentRunResult: AssertEqual<z.infer<typeof agentRunResultSchema>, AgentRunResult> = true;

export const toolCallSchema = z.custom<{ name: string; args: unknown; result: unknown }>(
  (val) => typeof val === 'object' && val !== null && 'name' in val && typeof (val as Record<string, unknown>)['name'] === 'string',
);

// 12. ChatAnswer
export const chatAnswerSchema = z.object({
  text: z.string(),
  toolCalls: z.array(toolCallSchema),
  comparison: scenarioComparisonSchema.optional(),
  forecast: forecastResultSchema.optional(),
}) satisfies z.ZodType<ChatAnswer>;

const _assertChatAnswer: AssertEqual<z.infer<typeof chatAnswerSchema>, ChatAnswer> = true;

// 13. Snapshot
export const snapshotSchema = z.object({
  business: businessSchema,
  payers: z.array(payerSchema),
  invoices: z.array(invoiceSchema),
  obligations: z.array(obligationSchema),
  policy: policySchema,
}) satisfies z.ZodType<Snapshot>;

const _assertSnapshot: AssertEqual<z.infer<typeof snapshotSchema>, Snapshot> = true;

// 14. SseEvent
export const sseEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('invoice.updated'),
    payload: invoiceSchema,
  }),
  z.object({
    type: z.literal('action.updated'),
    payload: actionRecordSchema,
  }),
  z.object({
    type: z.literal('audit.appended'),
    payload: auditEventSchema,
  }),
  z.object({
    type: z.literal('forecast.updated'),
    payload: forecastResultSchema,
  }),
]) satisfies z.ZodType<SseEvent>;

const _assertSseEvent: AssertEqual<z.infer<typeof sseEventSchema>, SseEvent> = true;

// Suppress unused variable warnings for compile-time assertions
void _assertBusiness;
void _assertPayer;
void _assertInvoice;
void _assertObligation;
void _assertPolicy;
void _assertPolicyVerdict;
void _assertDayBalance;
void _assertForecastResult;
void _assertScenarioChange;
void _assertScenarioComparison;
void _assertActionRecord;
void _assertKpis;
void _assertAuditEvent;
void _assertAgentRunResult;
void _assertChatAnswer;
void _assertSnapshot;
void _assertSseEvent;
