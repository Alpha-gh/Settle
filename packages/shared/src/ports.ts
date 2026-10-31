import type * as T from './types';

export interface EnginePort {                       // System 2 implements
  expectedReceipts(invoices: T.Invoice[], payers: T.Payer[], asOf: T.ISODate): T.ExpectedReceipt[];
  forecast(input: T.ForecastInput): T.ForecastResult;
  simulate(input: T.ForecastInput, change: T.ScenarioChange): T.ScenarioComparison;
  generateOptions(input: T.ForecastInput, invoice: T.Invoice, payer: T.Payer, policy: T.Policy): T.ScenarioChange[];
  kpis(snapshot: T.Snapshot): T.Kpis;
}
export interface LlmPort {                          // System 3 implements (adapters + mock)
  generateStructured<R>(a: { system: string; user: string; jsonSchema: object }): Promise<R>;
  runWithTools(a: { system: string; messages: { role: 'user' | 'assistant'; content: string }[];
    tools: { name: string; description: string; jsonSchema: object; run(args: any): Promise<unknown> }[];
    maxSteps: number }): Promise<{ text: string; toolCalls: { name: string; args: unknown; result: unknown }[] }>;
}
export interface AgentPort {                        // System 3 implements; System 1 calls
  runCycle(snapshot: T.Snapshot): Promise<T.AgentRunResult>;
  chat(question: string, snapshot: T.Snapshot): Promise<T.ChatAnswer>;
}
export interface PayPalPort {                       // System 1 implements (sandbox); agent never touches it
  createAndSendInvoice(inv: T.Invoice, payer: T.Payer): Promise<{ paypalInvoiceId: string; payUrl: string }>;
  sendReminder(paypalInvoiceId: string, note: string): Promise<void>;
  updateInvoice(paypalInvoiceId: string, patch: { discountPct?: number; dueDate?: T.ISODate; allowPartial?: boolean; minimumAmountDue?: T.Cents }): Promise<void>;
  getInvoice(paypalInvoiceId: string): Promise<{ status: T.InvoiceStatus; amountPaid: T.Cents }>;
}
