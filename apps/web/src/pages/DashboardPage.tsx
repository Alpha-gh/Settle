import React, { useEffect } from 'react';
import { useDashboard, useSnapshot, useForecast, useActions } from '../api/queries';
import { formatDate } from '../lib/format';
import { useSelectedAction } from '../state/selection';
import { useBreachMemory } from '../state/breachMemory';
import { RunSettleButton } from '../components/RunSettleButton';
import { BreachBanner } from '../components/BreachBanner';
import { GapClosedBanner } from '../components/GapClosedBanner';
import { KpiCards } from '../components/KpiCards';
import { BalanceChart } from '../components/BalanceChart';
import { Worklist } from '../components/Worklist';
import { ImpactCard } from '../components/ImpactCard';
import { AuditTimeline } from '../components/AuditTimeline';

export const DashboardPage: React.FC = () => {
  const { data: dashboard } = useDashboard();
  const { data: snapshot, isLoading: loadingSnapshot } = useSnapshot();
  const { data: forecast, isLoading: loadingForecast } = useForecast();
  const { data: actions = [] } = useActions();
  const { selectedActionId } = useSelectedAction();
  const { hadBreach, recordForecast } = useBreachMemory();

  // Keep breach memory updated from live forecast data
  useEffect(() => {
    if (forecast) {
      recordForecast(forecast);
    }
  }, [forecast, recordForecast]);

  // Find simulation scenario if an action is currently selected in URL search params
  const selectedAction = actions.find((a) => a.id === selectedActionId);
  const scenarioForecast = selectedAction?.simulation?.scenario;
  const scenarioLabel = selectedAction
    ? `Scenario: ${selectedAction.type} (${selectedAction.id})`
    : undefined;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* 1. Header row: Title "Cash outlook", as-of date from snapshot, Run Settle button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Cash outlook</h1>
          <p className="text-sm text-muted">
            {snapshot
              ? `As of ${formatDate(snapshot.business.asOf)} (${snapshot.business.name})`
              : 'Loading workspace anchor date...'}
          </p>
        </div>
        <RunSettleButton />
      </div>

      {/* 2. Banner area: Breach banner or Gap-closed banner */}
      {forecast && (
        <div className="space-y-4">
          <BreachBanner forecast={forecast} snapshot={snapshot} />
          <GapClosedBanner forecast={forecast} hadBreach={hadBreach} />
        </div>
      )}

      {(dashboard?.warnings?.length ?? 0) > 0 && (
        <div
          data-testid="records-warnings-note"
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
        >
          Some records could not be displayed
        </div>
      )}

      {/* 3. KPI row from GET /api/kpis */}
      <section aria-label="Key Financial Performance Indicators">
        <KpiCards />
      </section>

      {/* 4. Hero chart card */}
      <section aria-label="Forecast Liquidity Chart">
        {loadingForecast || loadingSnapshot || !forecast || !snapshot ? (
          <div className="h-96 bg-surface border border-border rounded p-6 animate-pulse flex items-center justify-center">
            <span className="text-sm text-muted">Loading cash forecast chart...</span>
          </div>
        ) : (
          <BalanceChart
            forecast={forecast}
            reserve={snapshot.business.reserveThreshold}
            scenario={scenarioForecast}
            scenarioLabel={scenarioLabel}
            height={360}
          />
        )}
      </section>

      {/* 5. Receivables Worklist (Stage 3) */}
      <section aria-label="Receivables Worklist">
        <Worklist height={420} />
      </section>

      {/* 6. Impact Recovery Summary (Stage 4) */}
      <section aria-label="Recovery Impact Summary">
        <ImpactCard />
      </section>

      {/* 7. Recent Activity Audit Trail (Stage 4) */}
      <section aria-label="Recent Audit Activity" className="space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-base font-semibold text-ink">Recent Audit Activity</h2>
          <span className="text-xs text-muted">Latest 5 events</span>
        </div>
        <AuditTimeline compact limit={5} />
      </section>
    </div>
  );
};
