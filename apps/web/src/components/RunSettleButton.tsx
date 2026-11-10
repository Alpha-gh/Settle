import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiHttpError } from '../api/client';
import { useRunAgent, useAgentStatus, QUERY_KEYS } from '../api/queries';
import { TEST_IDS } from '../testids';

function isRunInProgressConflict(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ApiHttpError && err.status === 409) {
    const body = err.responseBody as { error?: { code?: string } } | undefined;
    return !body?.error?.code || body.error.code === 'AGENT_RUN_IN_PROGRESS';
  }
  if (err instanceof Error) {
    return (
      err.message.includes('AGENT_RUN_IN_PROGRESS') ||
      /\[409\]/.test(err.message)
    );
  }
  return false;
}

export const RunSettleButton: React.FC = () => {
  const queryClient = useQueryClient();
  const runAgentMutation = useRunAgent();
  const isExecutingRef = useRef(false);
  const waitingStartedAtRef = useRef<number>(0);
  const [waitingForRun, setWaitingForRun] = useState(false);
  const [dismissedConflictError, setDismissedConflictError] = useState<unknown>(null);

  const isPending = runAgentMutation.isPending;
  const result = runAgentMutation.data;
  const isError = runAgentMutation.isError;
  const error = runAgentMutation.error;
  const isConflictError =
    isError && error !== dismissedConflictError && isRunInProgressConflict(error);
  const isWaiting = waitingForRun || isConflictError;

  const agentStatusQuery = useAgentStatus(isWaiting);

  useEffect(() => {
    if (isWaiting && waitingStartedAtRef.current === 0) {
      waitingStartedAtRef.current = Date.now();
    }
    if (!isWaiting) {
      waitingStartedAtRef.current = 0;
    }
  }, [isWaiting]);

  useEffect(() => {
    if (!isWaiting) return;
    const statusData = agentStatusQuery.data;
    const updatedAt = agentStatusQuery.dataUpdatedAt;
    const isFreshResponse =
      updatedAt === undefined || updatedAt >= waitingStartedAtRef.current;

    if (statusData && !statusData.running && isFreshResponse) {
      setWaitingForRun(false);
      if (isConflictError) {
        setDismissedConflictError(error);
      }
      runAgentMutation.reset?.();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actions });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.kpis });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.forecast });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.impact });
    }
  }, [
    isWaiting,
    agentStatusQuery.data,
    agentStatusQuery.dataUpdatedAt,
    isConflictError,
    error,
    runAgentMutation,
    queryClient,
  ]);

  const handleRun = () => {
    // Double-click safety: ignore if already executing, pending, or waiting
    if (isExecutingRef.current || isPending || isWaiting) {
      return;
    }
    isExecutingRef.current = true;
    setDismissedConflictError(null);

    runAgentMutation.mutate(undefined, {
      onSettled: () => {
        isExecutingRef.current = false;
      },
      onError: (err) => {
        if (isRunInProgressConflict(err)) {
          waitingStartedAtRef.current = Date.now();
          setWaitingForRun(true);
        }
      },
      onSuccess: () => {
        setWaitingForRun(false);
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
  const isWorking = isPending || isWaiting;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        data-testid={TEST_IDS.runSettle}
        onClick={handleRun}
        disabled={isWorking}
        className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isWorking ? 'Settle is working...' : 'Run Settle'}
      </button>

      {/* Indeterminate progress bar while running or waiting */}
      {isWorking && (
        <div
          data-testid={TEST_IDS.runSettleProgress}
          className="w-36 bg-blue-100 h-1 rounded overflow-hidden"
          role="progressbar"
          aria-label="Running Settle agent evaluation cycle"
        >
          <div className="h-full bg-accent animate-pulse w-full" />
        </div>
      )}

      {/* Calm waiting notice when another run is in progress (409) */}
      {!isPending && isWaiting && (
        <div
          data-testid={TEST_IDS.runSettleWaiting}
          className="text-xs text-muted flex items-center gap-2 font-medium"
        >
          <span>A run is already in progress, waiting...</span>
        </div>
      )}

      {/* Success result notification */}
      {result && !isWorking && (
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

      {/* Error state with retry (never shown for 409 AGENT_RUN_IN_PROGRESS) */}
      {isError && !isPending && !isWaiting && (
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

