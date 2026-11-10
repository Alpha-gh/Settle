import React, { useState, useEffect } from 'react';
import type { SchemaErrorInfo } from '../api/client';
import { TEST_IDS } from '../testids';

export const DevErrorOverlay: React.FC = () => {
  const [errorInfo, setErrorInfo] = useState<SchemaErrorInfo | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<SchemaErrorInfo>;
      setErrorInfo(customEvent.detail);
    };

    window.addEventListener('settle:schema-error', handler);
    return () => {
      window.removeEventListener('settle:schema-error', handler);
    };
  }, []);

  if (!import.meta.env.DEV || !errorInfo) {
    return null;
  }

  return (
    <div
      data-testid={TEST_IDS.devErrorOverlay}
      className="fixed inset-x-0 top-0 z-50 bg-status-red text-white p-4 shadow-lg border-b-4 border-red-900 font-sans"
      role="alert"
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold uppercase tracking-wider text-xs px-2 py-0.5 bg-red-900 rounded text-red-100">
              Contract Violation
            </span>
            <h2 className="text-base font-semibold">
              Schema Parse Failure at:{' '}
              <span data-testid={TEST_IDS.devErrorOverlayEndpoint} className="underline font-mono">
                {errorInfo.endpoint}
              </span>
            </h2>
          </div>
          <button
            data-testid={TEST_IDS.devErrorOverlayDismiss}
            onClick={() => setErrorInfo(null)}
            className="text-xs bg-red-900 hover:bg-red-800 text-white px-3 py-1 rounded font-medium border border-red-700 focus:outline-none focus:ring-2 focus:ring-white"
          >
            Dismiss
          </button>
        </div>

        <p className="text-xs text-red-100">
          The API response did not match the required contract schema. Check the details below:
        </p>

        <div
          data-testid={TEST_IDS.devErrorOverlayDetails}
          className="bg-red-950 p-3 rounded font-mono text-xs overflow-x-auto max-h-48 border border-red-800"
        >
          <ul className="list-disc pl-5 space-y-1">
            {errorInfo.issues.map((issue, idx) => (
              <li key={idx}>
                <strong className="text-red-200">
                  {issue.path.length > 0 ? issue.path.join('.') : '(root)'}:
                </strong>{' '}
                <span className="text-red-300">{issue.message}</span>
                {issue.code && <span className="text-red-400 ml-2">[{issue.code}]</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

