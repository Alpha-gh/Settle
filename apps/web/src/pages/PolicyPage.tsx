import React from 'react';
import { usePolicy } from '../api/queries';
import { formatUsd } from '../lib/format';

export const PolicyPage: React.FC = () => {
  const { data: policy, isLoading } = usePolicy();

  if (isLoading) {
    return <div className="text-sm text-muted">Loading policy rules...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Collections Policy Rules</h1>
        <p className="text-sm text-muted">
          Agent operational boundaries and human-in-the-loop review thresholds
        </p>
      </div>

      <div className="bg-surface border border-border rounded p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-slate-50 rounded border border-border">
            <span className="text-xs text-muted block uppercase">Max Allowed Discount</span>
            <span className="text-lg font-bold text-ink tabular">{policy?.maxDiscountPct}%</span>
          </div>

          <div className="p-3 bg-slate-50 rounded border border-border">
            <span className="text-xs text-muted block uppercase">Auto-Approve Max Amount</span>
            <span className="text-lg font-bold text-ink tabular">
              {policy ? formatUsd(policy.autoApproveMaxAmount) : '—'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded border border-border">
            <span className="text-xs text-muted block uppercase">Max Split Instalments</span>
            <span className="text-lg font-bold text-ink tabular">{policy?.maxInstalments} parts</span>
          </div>

          <div className="p-3 bg-slate-50 rounded border border-border">
            <span className="text-xs text-muted block uppercase">Max Reminders per Week</span>
            <span className="text-lg font-bold text-ink tabular">
              {policy?.maxRemindersPerInvoicePerWeek}
            </span>
          </div>
        </div>

        <div className="pt-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider block mb-2">
            Actions Requiring Human-In-The-Loop Approval
          </span>
          <div className="flex gap-2">
            {policy?.requireApprovalFor.map((action) => (
              <span
                key={action}
                className="px-2.5 py-1 rounded bg-amber-50 text-status-amber border border-amber-200 text-xs font-medium"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

