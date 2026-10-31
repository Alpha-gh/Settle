export type Cents = number;      // integer, USD only
export type ISODate = string;    // 'YYYY-MM-DD'
export type Id = string;

export interface Business { id: Id; name: string; currency: 'USD'; asOf: ISODate; startingBalance: Cents; reserveThreshold: Cents; }

export type PayerPersona = 'reliable' | 'slow' | 'chronic' | 'ghost';
export interface Payer { id: Id; name: string; email: string; persona: PayerPersona; avgDaysLate: number; latenessRisk: number; /* 0..1 */ }

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';
export interface Invoice {
  id: Id; payerId: Id; number: string; description: string;
  amount: Cents; amountPaid: Cents; issueDate: ISODate; dueDate: ISODate;
  status: InvoiceStatus; discountPct: number; /* 0 if none */
  allowPartial: boolean; minimumAmountDue?: Cents;
  paypalInvoiceId?: string; payUrl?: string;
}

export type ObligationKind = 'payroll' | 'rent' | 'tax' | 'supplier' | 'other';
export interface Obligation { id: Id; label: string; kind: ObligationKind; amount: Cents; dueDate: ISODate; }

export type Confidence = 'confirmed' | 'expected' | 'uncertain';
export interface ExpectedReceipt { invoiceId: Id; amount: Cents; date: ISODate; confidence: Confidence; }

// ---------- Engine ----------
export interface ForecastInput {
  business: Business; obligations: Obligation[]; receipts: ExpectedReceipt[];
  horizonDays: number;            // default 30, includes asOf day
  includeUncertain?: boolean;     // default false (conservative)
}
export interface DayBalance { date: ISODate; receipts: Cents; outflows: Cents; closing: Cents; belowReserve: boolean; }
export interface ForecastResult {
  days: DayBalance[];
  lowest: { date: ISODate; amount: Cents };
  firstBreachDate: ISODate | null;  // first day closing < reserve
  shortfall: Cents;                 // max(0, reserve - lowest.amount)
}
export type ScenarioChange =
  | { type: 'REMIND'; invoiceId: Id; newExpectedDate: ISODate }
  | { type: 'OFFER_DISCOUNT'; invoiceId: Id; discountPct: number; newExpectedDate: ISODate }
  | { type: 'OFFER_INSTALMENTS'; invoiceId: Id; count: number; spacingDays: number; firstDate: ISODate }
  | { type: 'PURCHASE'; label: string; amount: Cents; date: ISODate };
export interface ScenarioComparison {
  change: ScenarioChange; baseline: ForecastResult; scenario: ForecastResult;
  lowestDelta: Cents; shortfallDelta: Cents;
  cashCost: Cents;                // money given up (discount) vs full payment
  closesGap: boolean;             // scenario.firstBreachDate === null && baseline.firstBreachDate !== null
  assumptions: string[];          // plain-language assumptions behind the dates
}
export interface Kpis { cash: Cents; overdueTotal: Cents; overdueCount: number; avgDaysLate: number; lowest: { date: ISODate; amount: Cents }; shortfall: Cents; nextObligation?: Obligation; }

// ---------- Policy ----------
export interface Policy {
  maxDiscountPct: number; maxInstalments: number; autoApproveMaxAmount: Cents;
  requireApprovalFor: ('OFFER_DISCOUNT' | 'OFFER_INSTALMENTS' | 'ESCALATE')[];
  quietHours: { startHour: number; endHour: number };
  maxRemindersPerInvoicePerWeek: number;
}
export interface PolicyVerdict { allowed: boolean; requiresApproval: boolean; violations: string[]; }

// ---------- Actions and audit ----------
export type ActionType = 'REMIND' | 'OFFER_DISCOUNT' | 'OFFER_INSTALMENTS' | 'ESCALATE' | 'NO_ACTION';
export type ActionStatus = 'PROPOSED' | 'AWAITING_APPROVAL' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'BLOCKED' | 'FAILED';
export interface ActionParams { discountPct?: number; instalments?: { count: number; spacingDays: number }; note?: string; }
export interface ActionRecord {
  id: Id; invoiceId: Id; type: ActionType; params: ActionParams; reason: string;
  simulation?: ScenarioComparison; policy: PolicyVerdict; status: ActionStatus;
  createdAt: string; decidedBy?: 'owner' | 'auto'; executedAt?: string;
  paypalRequestId?: string; error?: string;
}
export type AuditActor = 'agent' | 'owner' | 'paypal' | 'system';
export interface AuditEvent { id: Id; ts: string; actor: AuditActor; kind: string; summary: string; invoiceId?: Id; actionId?: Id; paypalRequestId?: string; detail?: unknown; }

// ---------- Agent ----------
export interface AgentRunResult { runId: Id; actions: ActionRecord[]; skipped: { invoiceId: Id; why: string }[]; }
export interface ChatAnswer { text: string; toolCalls: { name: string; args: unknown; result: unknown }[]; comparison?: ScenarioComparison; forecast?: ForecastResult; }

// ---------- Snapshot and live events ----------
export interface Snapshot { business: Business; payers: Payer[]; invoices: Invoice[]; obligations: Obligation[]; policy: Policy; }
export type SseEvent =
  | { type: 'invoice.updated'; payload: Invoice }
  | { type: 'action.updated'; payload: ActionRecord }
  | { type: 'audit.appended'; payload: AuditEvent }
  | { type: 'forecast.updated'; payload: ForecastResult };
