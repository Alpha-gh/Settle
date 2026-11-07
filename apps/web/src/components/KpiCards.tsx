import React from 'react';
import { useKpis } from '../api/queries';
import { formatUsd, formatDate } from '../lib/format';
import { TEST_IDS } from '../testids';

export const KpiCards: React.FC = () => {
  const { data: kpis, isLoading, isError, error, refetch } = useKpis();

  if (isLoading) {
    return (
      <div
        data-testid={TEST_IDS.kpiSkeleton}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse"
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 bg-slate-100 rounded border border-border p-4 flex flex-col justify-between"
          >
            <div className="h-3 bg-slate-200 rounded w-1/2"></div>
            <div className="h-7 bg-slate-200 rounded w-3/4"></div>
            <div className="h-3 bg-slate-200 rounded w-1/3"></div>
          </div>
        ))}
      </div>
    );
  }

  if (isError || !kpis) {
    return (
      <div
        data-testid={TEST_IDS.kpiError}
        className="p-4 bg-status-red-bg border border-status-red text-status-red rounded flex items-center justify-between"
      >
        <div>
          <p className="text-sm font-semibold">Failed to load financial KPIs</p>
          <p className="text-xs text-red-700">{error?.message || 'Unknown network error'}</p>
        </div>
        <button
          data-testid={TEST_IDS.kpiRetry}
          onClick={() => refetch()}
          className="px-3 py-1.5 bg-status-red text-white text-xs font-medium rounded hover:bg-red-800 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Retry
        </button>
      </div>
    );
  }

  const isBreached = kpis.shortfall > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Cash today */}
      <div
        data-testid={TEST_IDS.kpiCash}
        className="bg-surface p-4 rounded border border-border flex flex-col justify-between"
      >
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Cash today
        </span>
        <div className="text-2xl font-bold text-ink mt-2 tabular">
          {formatUsd(kpis.cash)}
        </div>
        <span className="text-xs text-muted mt-1">Available liquid cash</span>
      </div>

      {/* 2. Lowest balance */}
      <div
        data-testid={TEST_IDS.kpiLowest}
        className="bg-surface p-4 rounded border border-border flex flex-col justify-between"
      >
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Lowest balance
        </span>
        <div className="text-2xl font-bold text-ink mt-2 tabular">
          {formatUsd(kpis.lowest.amount)}
        </div>
        <span className="text-xs text-muted mt-1">
          on {formatDate(kpis.lowest.date)}
        </span>
      </div>

      {/* 3. Shortfall (turns red ONLY when shortfall > 0) */}
      <div
        data-testid={TEST_IDS.kpiShortfall}
        className={`p-4 rounded border flex flex-col justify-between transition-colors ${
          isBreached
            ? 'bg-status-red-bg border-status-red'
            : 'bg-surface border-border'
        }`}
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${
            isBreached ? 'text-status-red' : 'text-muted'
          }`}
        >
          Projected shortfall
        </span>
        <div
          className={`text-2xl font-bold mt-2 tabular ${
            isBreached ? 'text-status-red' : 'text-status-green'
          }`}
        >
          {formatUsd(kpis.shortfall)}
        </div>
        <span
          className={`text-xs mt-1 ${
            isBreached ? 'text-status-red font-medium' : 'text-muted'
          }`}
        >
          {isBreached ? 'Under reserve threshold' : 'Above reserve threshold'}
        </span>
      </div>

      {/* 4. Overdue total with count */}
      <div
        data-testid={TEST_IDS.kpiOverdue}
        className="bg-surface p-4 rounded border border-border flex flex-col justify-between"
      >
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Overdue total
        </span>
        <div className="text-2xl font-bold text-ink mt-2 tabular">
          {formatUsd(kpis.overdueTotal)}
        </div>
        <span className="text-xs text-muted mt-1">
          {kpis.overdueCount} invoice{kpis.overdueCount === 1 ? '' : 's'} ({kpis.avgDaysLate}d avg)
        </span>
      </div>
    </div>
  );
};

