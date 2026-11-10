import type { Invoice, Payer, ActionRecord, Snapshot } from '@settle/shared';
import { daysOverdue } from '../lib/derive';

export interface WorklistRow {
  id: string; // invoice.id
  invoice: Invoice;
  payer?: Payer;
  action?: ActionRecord;
  daysOverdue: number;
}

/**
 * Pure join selector combining snapshot invoices, payers, and recovery actions.
 * No business arithmetic is performed; only permitted derivation is derive.daysOverdue.
 */
export function selectWorklistRows(
  snapshot?: Snapshot | null,
  actions: ActionRecord[] = [],
): WorklistRow[] {
  if (!snapshot || !snapshot.invoices) {
    return [];
  }

  const asOf = snapshot.business.asOf;
  const payerMap = new Map<string, Payer>();
  for (const p of snapshot.payers) {
    payerMap.set(p.id, p);
  }

  const actionMap = new Map<string, ActionRecord>();
  for (const a of actions) {
    actionMap.set(a.invoiceId, a);
  }

  return snapshot.invoices.map((invoice) => {
    return {
      id: invoice.id,
      invoice,
      payer: payerMap.get(invoice.payerId),
      action: actionMap.get(invoice.id),
      daysOverdue: daysOverdue(invoice.dueDate, asOf),
    };
  });
}

export function selectWorklistRowByActionId(
  rows: WorklistRow[],
  actionId: string,
): WorklistRow | undefined {
  return rows.find((r) => r.action?.id === actionId);
}

export function selectWorklistRowByInvoiceId(
  rows: WorklistRow[],
  invoiceId: string,
): WorklistRow | undefined {
  return rows.find((r) => r.id === invoiceId);
}

