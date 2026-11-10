import React from 'react';
import { Worklist } from '../components/Worklist';

export const ReceivablesPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Receivables Worklist</h1>
        <p className="text-sm text-muted">
          Outstanding client invoices, collection risks, and automated recovery actions
        </p>
      </div>

      <section aria-label="Receivables Worklist Table">
        <Worklist height={620} />
      </section>
    </div>
  );
};
