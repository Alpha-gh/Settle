import { eq, desc, and, isNull } from 'drizzle-orm';
import type {
  Business,
  Payer,
  Invoice,
  Obligation,
  Policy,
  ActionRecord,
  AuditEvent,
  Id,
} from '@settle/shared';
import { getDb } from './index.js';
import {
  businesses,
  payers,
  invoices,
  obligations,
  policies,
  actionRecords,
  auditEvents,
  invoicePayPalIds,
  processedWebhookEvents,
} from './schema.js';

// ── Business Repository ───────────────────────────────────────────────────
export class BusinessRepository {
  async get(): Promise<Business | null> {
    const db = getDb();
    const rows = await db.select().from(businesses).limit(1);
    return rows[0] || null;
  }

  async upsert(b: Business): Promise<void> {
    const db = getDb();
    await db
      .insert(businesses)
      .values(b)
      .onConflictDoUpdate({
        target: businesses.id,
        set: {
          name: b.name,
          currency: b.currency,
          asOf: b.asOf,
          startingBalance: b.startingBalance,
          reserveThreshold: b.reserveThreshold,
        },
      });
  }
}

// ── Payer Repository ──────────────────────────────────────────────────────
export class PayerRepository {
  async list(): Promise<Payer[]> {
    const db = getDb();
    return db.select().from(payers);
  }

  async getById(id: Id): Promise<Payer | null> {
    const db = getDb();
    const rows = await db.select().from(payers).where(eq(payers.id, id)).limit(1);
    return rows[0] || null;
  }
}

// ── Invoice Repository ────────────────────────────────────────────────────
export class InvoiceRepository {
  async list(): Promise<Invoice[]> {
    const db = getDb();
    const rows = await db.select().from(invoices);
    return rows.map((r) => ({
      ...r,
      minimumAmountDue: r.minimumAmountDue ?? undefined,
      paypalInvoiceId: r.paypalInvoiceId ?? undefined,
      payUrl: r.payUrl ?? undefined,
    }));
  }

  async getById(id: Id): Promise<Invoice | null> {
    const db = getDb();
    const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ...r,
      minimumAmountDue: r.minimumAmountDue ?? undefined,
      paypalInvoiceId: r.paypalInvoiceId ?? undefined,
      payUrl: r.payUrl ?? undefined,
    };
  }

  async getByPayPalInvoiceId(paypalInvoiceId: string): Promise<Invoice | null> {
    const db = getDb();
    // 1. Direct match on invoices.paypalInvoiceId
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paypalInvoiceId, paypalInvoiceId))
      .limit(1);
    if (rows[0]) {
      const r = rows[0];
      return {
        ...r,
        minimumAmountDue: r.minimumAmountDue ?? undefined,
        paypalInvoiceId: r.paypalInvoiceId ?? undefined,
        payUrl: r.payUrl ?? undefined,
      };
    }

    // 2. Lookup via invoice_paypal_ids history
    const history = await db
      .select()
      .from(invoicePayPalIds)
      .where(eq(invoicePayPalIds.paypalInvoiceId, paypalInvoiceId))
      .limit(1);
    if (history[0]) {
      return this.getById(history[0].invoiceId);
    }

    return null;
  }

  async update(id: Id, patch: Partial<Invoice>): Promise<Invoice> {
    const db = getDb();
    const [updated] = await db
      .update(invoices)
      .set(patch)
      .where(eq(invoices.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Invoice ${id} not found for update`);
    }

    return {
      ...updated,
      minimumAmountDue: updated.minimumAmountDue ?? undefined,
      paypalInvoiceId: updated.paypalInvoiceId ?? undefined,
      payUrl: updated.payUrl ?? undefined,
    };
  }

  async insert(inv: Invoice): Promise<void> {
    const db = getDb();
    await db.insert(invoices).values({
      id: inv.id,
      payerId: inv.payerId,
      number: inv.number,
      description: inv.description,
      amount: inv.amount,
      amountPaid: inv.amountPaid,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      discountPct: inv.discountPct,
      allowPartial: inv.allowPartial,
      minimumAmountDue: inv.minimumAmountDue,
      paypalInvoiceId: inv.paypalInvoiceId,
      payUrl: inv.payUrl,
    });
  }
}

// ── Obligation Repository ─────────────────────────────────────────────────
export class ObligationRepository {
  async list(): Promise<Obligation[]> {
    const db = getDb();
    return db.select().from(obligations);
  }
}

// ── Policy Repository ─────────────────────────────────────────────────────
export class PolicyRepository {
  async get(): Promise<Policy> {
    const db = getDb();
    const rows = await db.select().from(policies).where(eq(policies.id, 'default')).limit(1);
    if (rows[0]) {
      return {
        maxDiscountPct: rows[0].maxDiscountPct,
        maxInstalments: rows[0].maxInstalments,
        autoApproveMaxAmount: rows[0].autoApproveMaxAmount,
        requireApprovalFor: rows[0].requireApprovalFor,
        quietHours: rows[0].quietHours,
        maxRemindersPerInvoicePerWeek: rows[0].maxRemindersPerInvoicePerWeek,
      };
    }
    // Default fallback
    return {
      maxDiscountPct: 10,
      maxInstalments: 4,
      autoApproveMaxAmount: 200_000,
      requireApprovalFor: ['OFFER_DISCOUNT', 'ESCALATE'],
      quietHours: { startHour: 22, endHour: 7 },
      maxRemindersPerInvoicePerWeek: 3,
    };
  }

  async update(p: Policy): Promise<Policy> {
    const db = getDb();
    await db
      .insert(policies)
      .values({
        id: 'default',
        maxDiscountPct: p.maxDiscountPct,
        maxInstalments: p.maxInstalments,
        autoApproveMaxAmount: p.autoApproveMaxAmount,
        requireApprovalFor: p.requireApprovalFor,
        quietHours: p.quietHours,
        maxRemindersPerInvoicePerWeek: p.maxRemindersPerInvoicePerWeek,
      })
      .onConflictDoUpdate({
        target: policies.id,
        set: {
          maxDiscountPct: p.maxDiscountPct,
          maxInstalments: p.maxInstalments,
          autoApproveMaxAmount: p.autoApproveMaxAmount,
          requireApprovalFor: p.requireApprovalFor,
          quietHours: p.quietHours,
          maxRemindersPerInvoicePerWeek: p.maxRemindersPerInvoicePerWeek,
        },
      });
    return p;
  }
}

// ── Action Record Repository ──────────────────────────────────────────────
export class ActionRecordRepository {
  async list(): Promise<ActionRecord[]> {
    const db = getDb();
    const rows = await db.select().from(actionRecords).orderBy(desc(actionRecords.createdAt));
    return rows.map((r) => ({
      ...r,
      simulation: r.simulation ?? undefined,
      decidedBy: r.decidedBy ?? undefined,
      executedAt: r.executedAt ?? undefined,
      paypalRequestId: r.paypalRequestId ?? undefined,
      error: r.error ?? undefined,
    }));
  }

  async getById(id: Id): Promise<ActionRecord | null> {
    const db = getDb();
    const rows = await db.select().from(actionRecords).where(eq(actionRecords.id, id)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ...r,
      simulation: r.simulation ?? undefined,
      decidedBy: r.decidedBy ?? undefined,
      executedAt: r.executedAt ?? undefined,
      paypalRequestId: r.paypalRequestId ?? undefined,
      error: r.error ?? undefined,
    };
  }

  async insert(record: ActionRecord): Promise<void> {
    const db = getDb();
    await db.insert(actionRecords).values({
      id: record.id,
      invoiceId: record.invoiceId,
      type: record.type,
      params: record.params,
      reason: record.reason,
      simulation: record.simulation,
      policy: record.policy,
      status: record.status,
      createdAt: record.createdAt,
      decidedBy: record.decidedBy,
      executedAt: record.executedAt,
      paypalRequestId: record.paypalRequestId,
      error: record.error,
    });
  }

  async update(id: Id, patch: Partial<ActionRecord>): Promise<ActionRecord> {
    const db = getDb();
    const [updated] = await db
      .update(actionRecords)
      .set(patch)
      .where(eq(actionRecords.id, id))
      .returning();

    if (!updated) {
      throw new Error(`ActionRecord ${id} not found for update`);
    }

    return {
      ...updated,
      simulation: updated.simulation ?? undefined,
      decidedBy: updated.decidedBy ?? undefined,
      executedAt: updated.executedAt ?? undefined,
      paypalRequestId: updated.paypalRequestId ?? undefined,
      error: updated.error ?? undefined,
    };
  }
}

// ── Audit Event Repository (APPEND-ONLY) ──────────────────────────────────
// Note: Strict requirement: "AuditEvent is append-only (no update or delete code paths)."
export class AuditEventRepository {
  async append(event: AuditEvent): Promise<void> {
    const db = getDb();
    await db.insert(auditEvents).values({
      id: event.id,
      ts: event.ts,
      actor: event.actor,
      kind: event.kind,
      summary: event.summary,
      invoiceId: event.invoiceId,
      actionId: event.actionId,
      paypalRequestId: event.paypalRequestId,
      detail: event.detail,
    });
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.ts))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      invoiceId: r.invoiceId ?? undefined,
      actionId: r.actionId ?? undefined,
      paypalRequestId: r.paypalRequestId ?? undefined,
      detail: r.detail ?? undefined,
    }));
  }
}

// ── Invoice PayPal IDs History Repository ─────────────────────────────────
export class InvoicePayPalIdRepository {
  async record(
    invoiceId: Id,
    paypalInvoiceId: string,
    reason = 'initial_creation',
  ): Promise<void> {
    const db = getDb();
    await db.insert(invoicePayPalIds).values({
      id: `ipp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      invoiceId,
      paypalInvoiceId,
      createdAt: new Date().toISOString(),
      reason,
    });
  }

  async findActive(invoiceId: Id): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(invoicePayPalIds)
      .where(
        and(
          eq(invoicePayPalIds.invoiceId, invoiceId),
          isNull(invoicePayPalIds.replacedAt),
        ),
      )
      .orderBy(desc(invoicePayPalIds.createdAt))
      .limit(1);

    return rows[0]?.paypalInvoiceId || null;
  }

  async findByPayPalId(paypalInvoiceId: string) {
    const db = getDb();
    const rows = await db
      .select()
      .from(invoicePayPalIds)
      .where(eq(invoicePayPalIds.paypalInvoiceId, paypalInvoiceId))
      .limit(1);
    return rows[0] || null;
  }

  async markReplaced(oldPayPalId: string, reason = 'cancelled_and_reissued'): Promise<void> {
    const db = getDb();
    await db
      .update(invoicePayPalIds)
      .set({
        replacedAt: new Date().toISOString(),
        reason,
      })
      .where(eq(invoicePayPalIds.paypalInvoiceId, oldPayPalId));
  }
}

// ── Processed Webhook Events Repository (Idempotency) ─────────────────────
export class WebhookEventRepository {
  /**
   * Attempts to record a processed webhook event ID.
   * Returns true if newly recorded, false if already processed (deduplicated).
   */
  async recordEvent(id: string, eventType: string): Promise<boolean> {
    const db = getDb();
    try {
      await db.insert(processedWebhookEvents).values({
        id,
        eventType,
      });
      return true;
    } catch (err: any) {
      // Postgres error code 23505 is unique_violation
      if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('unique')) {
        return false;
      }
      throw err;
    }
  }

  async isProcessed(id: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select()
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.id, id))
      .limit(1);
    return rows.length > 0;
  }
}

