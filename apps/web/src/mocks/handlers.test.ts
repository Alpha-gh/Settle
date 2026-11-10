import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { mockState } from './state';
import {
  snapshotSchema,
  forecastResultSchema,
  kpisSchema,
  actionRecordSchema,
  auditEventSchema,
  policySchema,
  agentRunResultSchema,
  chatAnswerSchema,
} from '../api/schemas';
import { impactSummarySchema, deriveImpactSummary } from '../api/impactAdapter';
import { CANNED_CHAT_PROMPTS } from './fixtures/chat';

describe('MSW State and Handlers Schema Compliance', () => {
  beforeEach(() => {
    mockState.reset();
  });

  it('GET /api/snapshot returns data conforming to snapshotSchema', () => {
    const data = mockState.getSnapshot();
    const result = snapshotSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('GET /api/snapshot?mockInvoices=200 returns 200 schema-valid invoices', () => {
    const data = mockState.getSnapshot(true);
    expect(data.invoices.length).toBe(200);
    const result = snapshotSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('GET /api/forecast returns data conforming to forecastResultSchema', () => {
    const result = forecastResultSchema.safeParse(mockState.forecast);
    expect(result.success).toBe(true);
  });

  it('GET /api/kpis returns data conforming to kpisSchema', () => {
    const result = kpisSchema.safeParse(mockState.kpis);
    expect(result.success).toBe(true);
  });

  it('POST /api/agent/run generates actions conforming to agentRunResultSchema', () => {
    const result = mockState.runAgent();
    const parsed = agentRunResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);

    // Verify all 7 statuses are represented
    const statuses = new Set(result.actions.map((a) => a.status));
    expect(statuses.has('PROPOSED')).toBe(true);
    expect(statuses.has('AWAITING_APPROVAL')).toBe(true);
    expect(statuses.has('APPROVED')).toBe(true);
    expect(statuses.has('EXECUTED')).toBe(true);
    expect(statuses.has('REJECTED')).toBe(true);
    expect(statuses.has('BLOCKED')).toBe(true);
    expect(statuses.has('FAILED')).toBe(true);

    // Verify exactly one skipped invoice
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.invoiceId).toBe('inv_008');

    // Verify AWAITING_APPROVAL has ScenarioComparison whose closesGap is true
    const awaiting = result.actions.find((a) => a.status === 'AWAITING_APPROVAL');
    expect(awaiting?.simulation?.closesGap).toBe(true);

    // Verify BLOCKED carries violations
    const blocked = result.actions.find((a) => a.status === 'BLOCKED');
    expect(blocked?.policy.violations.length).toBeGreaterThan(0);

    // Verify FAILED carries error
    const failed = result.actions.find((a) => a.status === 'FAILED');
    expect(failed?.error).toBeDefined();
  });

  it('POST /api/actions/:id/approve transitions action to APPROVED and conforms to actionRecordSchema', () => {
    mockState.runAgent();
    const awaiting = mockState.actions.find((a) => a.status === 'AWAITING_APPROVAL')!;
    const approved = mockState.approveAction(awaiting.id, 'Approved for payroll closing');

    const parsed = actionRecordSchema.safeParse(approved);
    expect(parsed.success).toBe(true);
    expect(approved.status).toBe('APPROVED');
    expect(approved.decidedBy).toBe('owner');
  });

  it('POST /api/actions/:id/reject transitions action to REJECTED and conforms to actionRecordSchema', () => {
    mockState.runAgent();
    const awaiting = mockState.actions.find((a) => a.status === 'AWAITING_APPROVAL')!;
    const rejected = mockState.rejectAction(awaiting.id, 'Refused');

    const parsed = actionRecordSchema.safeParse(rejected);
    expect(parsed.success).toBe(true);
    expect(rejected.status).toBe('REJECTED');
  });

  it('POST /api/actions/:id/retry transitions action and conforms to actionRecordSchema', () => {
    mockState.runAgent();
    const failed = mockState.actions.find((a) => a.status === 'FAILED')!;
    const retried = mockState.retryAction(failed.id);

    const parsed = actionRecordSchema.safeParse(retried);
    expect(parsed.success).toBe(true);
  });

  it('GET /api/audit conforms to auditEventSchema array', () => {
    const parsed = z.array(auditEventSchema).safeParse(mockState.audit);
    expect(parsed.success).toBe(true);
  });

  it('GET & PUT /api/policy conform to policySchema', () => {
    const getParsed = policySchema.safeParse(mockState.policy);
    expect(getParsed.success).toBe(true);

    const updated = mockState.updatePolicy({
      ...mockState.policy,
      maxDiscountPct: 7,
    });
    const putParsed = policySchema.safeParse(updated);
    expect(putParsed.success).toBe(true);
    expect(updated.maxDiscountPct).toBe(7);
  });

  it('POST /api/chat canned and fallback answers conform to chatAnswerSchema', () => {
    for (const prompt of Object.values(CANNED_CHAT_PROMPTS)) {
      const answer = mockState.chat(prompt);
      const parsed = chatAnswerSchema.safeParse(answer);
      expect(parsed.success).toBe(true);
      expect(answer.toolCalls.length).toBeGreaterThan(0);
    }

    const fallback = mockState.chat('What is the weather today?');
    const fallbackParsed = chatAnswerSchema.safeParse(fallback);
    expect(fallbackParsed.success).toBe(true);
  });

  it('GET /api/impact conforms to impactSummarySchema', () => {
    mockState.runAgent();
    const impact = deriveImpactSummary(mockState.actions, mockState.forecast);
    const parsed = impactSummarySchema.safeParse(impact);
    expect(parsed.success).toBe(true);
  });

  it('POST /api/demo/simulate-payment closes gap and updates forecast', () => {
    const initialShortfall = mockState.forecast.shortfall;
    expect(initialShortfall).toBe(200000);

    const result = mockState.simulatePayment('inv_001');
    expect(result.status).toBe('ok');
    expect(result.invoice.status).toBe('PAID');

    expect(mockState.forecast.firstBreachDate).toBeNull();
    expect(mockState.forecast.shortfall).toBe(0);
  });
});

