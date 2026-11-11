import React from 'react';
import { useDashboard } from '../api/queries';
import { AuditTimeline } from '../components/AuditTimeline';

export const AuditPage: React.FC = () => {
  const { data: dashboard } = useDashboard();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Append-Only Audit Trail</h1>
        <p className="text-sm text-muted">
          Chronological record of all agent recovery evaluations, human approvals, and PayPal executions
        </p>
      </div>

      {(dashboard?.warnings?.length ?? 0) > 0 && (
        <div
          data-testid="records-warnings-note"
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
        >
          Some records could not be displayed
        </div>
      )}

      <AuditTimeline />
    </div>
  );
};
