import { loadSeedSnapshot } from '@settle/shared';
import { getDb, getRawSql } from './index.js';
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
import { runMigrations } from './migrate.js';

export async function resetDemoData(): Promise<void> {
  await runMigrations();
  const sql = getRawSql();

  // Truncate tables cleanly (respecting foreign keys)
  await sql.unsafe(`
    TRUNCATE TABLE 
      action_records,
      invoice_paypal_ids,
      invoices,
      obligations,
      payers,
      businesses,
      policies,
      audit_events,
      processed_webhook_events
    CASCADE;
  `);

  const snapshot = loadSeedSnapshot();
  const db = getDb();

  // 1. Business
  await db.insert(businesses).values({
    id: snapshot.business.id,
    name: snapshot.business.name,
    currency: snapshot.business.currency,
    asOf: snapshot.business.asOf,
    startingBalance: snapshot.business.startingBalance,
    reserveThreshold: snapshot.business.reserveThreshold,
  });

  // 2. Payers
  if (snapshot.payers.length > 0) {
    await db.insert(payers).values(
      snapshot.payers.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        persona: p.persona,
        avgDaysLate: p.avgDaysLate,
        latenessRisk: p.latenessRisk,
      })),
    );
  }

  // 3. Invoices
  if (snapshot.invoices.length > 0) {
    await db.insert(invoices).values(
      snapshot.invoices.map((inv) => ({
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
      })),
    );
  }

  // 4. Obligations
  if (snapshot.obligations.length > 0) {
    await db.insert(obligations).values(
      snapshot.obligations.map((o) => ({
        id: o.id,
        label: o.label,
        kind: o.kind,
        amount: o.amount,
        dueDate: o.dueDate,
      })),
    );
  }

  // 5. Policy
  await db.insert(policies).values({
    id: 'default',
    maxDiscountPct: snapshot.policy.maxDiscountPct,
    maxInstalments: snapshot.policy.maxInstalments,
    autoApproveMaxAmount: snapshot.policy.autoApproveMaxAmount,
    requireApprovalFor: snapshot.policy.requireApprovalFor,
    quietHours: snapshot.policy.quietHours,
    maxRemindersPerInvoicePerWeek: snapshot.policy.maxRemindersPerInvoicePerWeek,
  });

  // 6. Initial Audit Event
  await db.insert(auditEvents).values({
    id: `aud_init_${Date.now()}`,
    ts: new Date().toISOString(),
    actor: 'system',
    kind: 'demo.reset',
    summary: 'Demo dataset reset to baseline seed snapshot',
  });
}
