import React from 'react';
import { PolicyForm } from '../components/PolicyForm';

export const PolicyPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Collections Policy Rules</h1>
        <p className="text-sm text-muted">
          Agent operational boundaries, quiet hours, and human-in-the-loop review thresholds
        </p>
      </div>

      <PolicyForm />
    </div>
  );
};
