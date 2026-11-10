import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useActions, useDemoReset, useDemoSimulatePayment, useRunAgent, useSnapshot } from '../api/queries';
import { useSelectedAction } from '../state/selection';
import { TEST_IDS } from '../testids';

export const DemoControls: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [isDemo, setIsDemo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data: snapshot } = useSnapshot();
  const { data: actions } = useActions();
  const { selectedActionId, selectedInvoiceId } = useSelectedAction();

  const resetMutation = useDemoReset();
  const runAgentMutation = useRunAgent();
  const simulatePaymentMutation = useDemoSimulatePayment();

  // Detect ?demo=1 in URL or persistent sessionStorage
  useEffect(() => {
    const param = searchParams.get('demo');
    if (param === '1') {
      try {
        sessionStorage.setItem('settle:demo', '1');
      } catch {
        // ignore storage errors
      }
      setIsDemo(true);
    } else {
      try {
        if (sessionStorage.getItem('settle:demo') === '1') {
          setIsDemo(true);
        } else {
          setIsDemo(false);
        }
      } catch {
        setIsDemo(false);
      }
    }
  }, [searchParams]);

  if (!isDemo) {
    return null;
  }

  // Determine which invoice is currently targeted for simulated payment
  let targetInvoiceId: string | null = null;
  if (selectedInvoiceId) {
    targetInvoiceId = selectedInvoiceId;
  } else if (selectedActionId) {
    // Look up action's invoice
    const action = actions?.find((a) => a.id === selectedActionId);
    targetInvoiceId = action ? action.invoiceId : null;
  }

  const targetInvoice = snapshot?.invoices.find((i) => i.id === (targetInvoiceId || selectedInvoiceId));

  const handleReset = async () => {
    await resetMutation.mutateAsync();
    setConfirmReset(false);
  };

  const handleSimulatePayment = async () => {
    if (!targetInvoice) return;
    await simulatePaymentMutation.mutateAsync({ invoiceId: targetInvoice.id });
  };

  const handleRunAgent = async () => {
    await runAgentMutation.mutateAsync();
  };

  return (
    <div
      data-testid={TEST_IDS.demoPanel}
      className="fixed bottom-4 left-4 z-40 bg-surface border border-slate-300 rounded-lg p-3 max-w-xs space-y-2.5 text-xs text-ink"
      role="region"
      aria-label="Demo controls"
    >
      <div className="flex items-center justify-between border-b border-border pb-1.5">
        <span className="font-semibold text-muted uppercase tracking-wider text-[10px]">
          Demo controls
        </span>
      </div>

      <div className="space-y-2">
        {/* Run Agent Action */}
        <button
          type="button"
          data-testid={TEST_IDS.demoRunAgent}
          onClick={handleRunAgent}
          disabled={runAgentMutation.isPending}
          className="w-full py-1.5 px-3 rounded font-medium bg-slate-100 hover:bg-slate-200 text-ink border border-border text-left disabled:opacity-50 transition-colors"
        >
          {runAgentMutation.isPending ? 'Running agent...' : 'Run agent evaluation'}
        </button>

        {/* Simulate Payment for Selected Invoice */}
        <div>
          <button
            type="button"
            data-testid={TEST_IDS.demoSimulatePayment}
            onClick={handleSimulatePayment}
            disabled={!targetInvoice || simulatePaymentMutation.isPending || targetInvoice.status === 'PAID'}
            className="w-full py-1.5 px-3 rounded font-medium bg-slate-100 hover:bg-slate-200 text-ink border border-border text-left disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {simulatePaymentMutation.isPending
              ? 'Simulating payment...'
              : targetInvoice
              ? `Simulate payment for ${targetInvoice.number}`
              : 'Simulate payment for selected invoice'}
          </button>
          {!targetInvoice && (
            <p className="text-[10px] text-muted mt-0.5 px-1">
              Select an invoice in the worklist first
            </p>
          )}
          {targetInvoice?.status === 'PAID' && (
            <p className="text-[10px] text-green-700 mt-0.5 px-1">
              Invoice is already settled
            </p>
          )}
        </div>

        {/* Reset Ledger with Inline Confirm */}
        <div className="pt-1 border-t border-border">
          {confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-red-700 font-medium">Confirm reset?</span>
              <button
                type="button"
                data-testid={`${TEST_IDS.demoReset}-confirm`}
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="py-1 px-2 rounded bg-red-600 text-white font-medium hover:bg-red-700 text-[11px]"
              >
                Yes, reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="py-1 px-2 rounded bg-surface border border-border text-muted hover:text-ink text-[11px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid={TEST_IDS.demoReset}
              onClick={() => setConfirmReset(true)}
              disabled={resetMutation.isPending}
              className="w-full py-1.5 px-3 rounded font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 text-left transition-colors"
            >
              Reset ledger to baseline
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
