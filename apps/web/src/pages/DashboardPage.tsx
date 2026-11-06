import React from 'react';
import { useSnapshot, useForecast, useKpis } from '../api/queries';
import { formatUsd } from '../lib/format';

export const DashboardPage: React.FC = () => {
  const { data: snapshot, isLoading: loadingSnapshot } = useSnapshot();
  const { data: forecast, isLoading: loadingForecast } = useForecast();
  const { data: kpis, isLoading: loadingKpis } = useKpis();

  if (loadingSnapshot || loadingForecast || loadingKpis) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/4"></div>
        <div className="grid grid-cols-4 gap-4">
          <div className="h-24 bg-slate-200 rounded"></div>
          <div className="h-24 bg-slate-200 rounded"></div>
          <div className="h-24 bg-slate-200 rounded"></div>
          <div className="h-24 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Cashflow & Recovery Dashboard
          </h1>
          <p className="text-sm text-muted">
            Financial state as of {snapshot?.business.asOf} (Anchor date)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface p-5 rounded border border-border shadow-none">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider">
            Current Cash Balance
          </div>
          <div className="text-2xl font-bold text-ink mt-2 tabular">
            {kpis ? formatUsd(kpis.cash) : '—'}
          </div>
        </div>

        <div className="bg-surface p-5 rounded border border-border shadow-none">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider">
            Reserve Threshold
          </div>
          <div className="text-2xl font-bold text-ink mt-2 tabular">
            {snapshot ? formatUsd(snapshot.business.reserveThreshold) : '—'}
          </div>
        </div>

        <div className="bg-surface p-5 rounded border border-border shadow-none">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider">
            Total Overdue Receivables
          </div>
          <div className="text-2xl font-bold text-ink mt-2 tabular">
            {kpis ? formatUsd(kpis.overdueTotal) : '—'}
          </div>
        </div>

        <div className="bg-surface p-5 rounded border border-border shadow-none">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider">
            Projected Shortfall
          </div>
          <div
            className={`text-2xl font-bold mt-2 tabular ${
              kpis && kpis.shortfall > 0 ? 'text-status-red' : 'text-status-green'
            }`}
          >
            {kpis ? formatUsd(kpis.shortfall) : '—'}
          </div>
        </div>
      </div>

      <div className="bg-surface p-6 rounded border border-border">
        <h2 className="text-base font-semibold text-ink mb-2">30-Day Forecast Summary</h2>
        <p className="text-sm text-muted">
          First breach projected:{' '}
          <span className="font-medium text-ink font-mono">
            {forecast?.firstBreachDate ?? 'None (Reserve maintained)'}
          </span>
          . Lowest closing balance:{' '}
          <span className="font-medium text-ink tabular">
            {forecast ? formatUsd(forecast.lowest.amount) : '—'}
          </span>{' '}
          on <span className="font-mono">{forecast?.lowest.date}</span>.
        </p>
      </div>
    </div>
  );
};

