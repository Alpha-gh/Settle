import React from 'react';
import { useSnapshot } from '../api/queries';
import { formatUsd, formatDateShort, humanizeStatus } from '../lib/format';
import { daysOverdue } from '../lib/derive';

export const ReceivablesPage: React.FC = () => {
  const { data: snapshot, isLoading } = useSnapshot();

  if (isLoading) {
    return <div className="text-sm text-muted">Loading receivables...</div>;
  }

  const asOf = snapshot?.business.asOf ?? '2026-11-02';
  const invoices = snapshot?.invoices ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Receivables Worklist</h1>
        <p className="text-sm text-muted">Outstanding client invoices and collection status</p>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-slate-50 text-xs font-semibold uppercase tracking-wider text-muted">
              <th className="py-3 px-4">Invoice</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4">Due Date</th>
              <th className="py-3 px-4">Days Overdue</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((inv) => {
              const lateDays = daysOverdue(inv.dueDate, asOf);
              return (
                <tr key={inv.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-mono font-medium text-ink">{inv.number}</td>
                  <td className="py-3 px-4 text-muted">{inv.description}</td>
                  <td className="py-3 px-4 text-muted font-mono">{formatDateShort(inv.dueDate)}</td>
                  <td className="py-3 px-4 tabular">
                    {lateDays > 0 ? (
                      <span className="text-status-red font-medium">{lateDays} days</span>
                    ) : (
                      <span className="text-muted">On time</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-ink tabular">
                    {formatUsd(inv.amount)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        inv.status === 'PAID'
                          ? 'bg-status-green-bg text-status-green'
                          : 'bg-slate-100 text-muted'
                      }`}
                    >
                      {humanizeStatus(inv.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

