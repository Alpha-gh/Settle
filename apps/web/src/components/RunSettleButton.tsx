import React, { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRunAgent, QUERY_KEYS } from '../api/queries';
import { TEST_IDS } from '../testids';

export const RunSettleButton: React.FC = () => {
  const queryClient = useQueryClient();
  const runAgentMutation = useRunAgent();
  const isExecutingRef = useRef(false);

  const isPending = runAgentMutation.isPending;
  const result = runAgentMutation.data;
  const isError = runAgentMutation.isError;
  const error = runAgentMutation.error;

  const handleRun = () => {
    // Double-click safety: ignore if already executing or mutation is pending
    if (isExecutingRef.current || isPending) {
      return;
    }
    isExecutingRef.current = true;

    runAgentMutation.mutate(undefined, {
      onSettled: () => {
        isExecutingRef.current = false;
      },
      onSuccess: () => {
        // Ensure actions, kpis, and forecast are invalidated
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.kpis });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.forecast });
      },
    });
  };

  const handleFocusWorklist = (e: React.MouseEvent) => {
    e.preventDefault();
    const worklistElement = document.getElementById('worklist');
    if (worklistElement) {
      worklistElement.scrollIntoView({ behavior: 'smooth' });
      worklistElement.focus();
    }
  };

  const actionsCount = result?.actions.length ?? 0;
  const skippedCount = result?.skipped.length ?? 0;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        data-testid={TEST_IDS.runSettle}
        onClick={handleRun}
        disabled={isPending}
        className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isPending ? 'Running Settle' : 'Run Settle'}
      </button>

      {/* Indeterminate progress bar while running */}
      {isPending && (
        <div
          data-testid={TEST_IDS.runSettleProgress}
          className="w-36 bg-blue-100 h-1 rounded overflow-hidden"
          role="progressbar"
          aria-label="Running Settle agent evaluation cycle"
        >
          <div className="h-full bg-accent animate-pulse w-full" />
        </div>
      )}

      {/* Success result notification */}
      {result && !isPending && (
        <div
          data-testid={TEST_IDS.runSettleResult}
          className="text-xs text-status-green flex items-center gap-2 font-medium"
        >
          <span>
            {actionsCount} action{actionsCount === 1 ? '' : 's'} proposed, {skippedCount} invoice{skippedCount === 1 ? '' : 's'} skipped.
          </span>
          <a
            href="#worklist"
            onClick={handleFocusWorklist}
            className="underline font-semibold hover:text-green-800 transition-colors"
          >
            Review actions
          </a>
        </div>
      )}

      {/* Error state with retry */}
      {isError && !isPending && (
        <div
          data-testid={TEST_IDS.runSettleError}
          className="text-xs text-status-red flex items-center gap-2 font-medium"
        >
          <span>{error?.message || 'Agent cycle failed'}</span>
          <button
            data-testid={TEST_IDS.runSettleRetry}
            onClick={handleRun}
            className="underline font-semibold hover:text-red-800 focus:outline-none"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

