import React from 'react';
import { useAudit } from '../api/queries';

export const AuditPage: React.FC = () => {
  const { data: audit, isLoading } = useAudit();

  if (isLoading) {
    return <div className="text-sm text-muted">Loading audit trail...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Append-Only Audit Trail</h1>
        <p className="text-sm text-muted">
          Cryptographically immutable record of all recovery decisions and financial events
        </p>
      </div>

      <div className="bg-surface border border-border rounded divide-y divide-border">
        {audit?.map((item) => (
          <div key={item.id} className="p-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-mono px-2 py-0.5 rounded bg-slate-100 text-muted font-medium">
                  {item.actor}
                </span>
                <span className="text-xs text-muted font-mono">{item.ts}</span>
              </div>
              <p className="text-sm font-medium text-ink">{item.summary}</p>
            </div>
            {item.paypalRequestId && (
              <span className="text-xs font-mono text-muted bg-slate-50 px-2 py-1 rounded border border-border">
                {item.paypalRequestId}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

