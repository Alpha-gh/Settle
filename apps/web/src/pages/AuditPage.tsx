import React from 'react';
import { AuditTimeline } from '../components/AuditTimeline';

export const AuditPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Append-Only Audit Trail</h1>
        <p className="text-sm text-muted">
          Chronological record of all agent recovery evaluations, human approvals, and PayPal executions
        </p>
      </div>

      <AuditTimeline />
    </div>
  );
};
