import React, { useEffect } from 'react';
import { useSnapshot, useForecast, useActions } from '../api/queries';
import { formatDate } from '../lib/format';
import { useSelectedAction } from '../state/selection';
import { useBreachMemory } from '../state/breachMemory';
import { TEST_IDS } from '../testids';
import { RunSettleButton } from '../components/RunSettleButton';
import { BreachBanner } from '../components/BreachBanner';
import { GapClosedBanner } from '../components/GapClosedBanner';
import { KpiCards } from '../components/KpiCards';
import { BalanceChart } from '../components/BalanceChart';

export const DashboardPage: React.FC = () => {
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

      {/* 5. Placeholder card: Receivables (Stage 3 fills it) */}
      <div
        id="worklist"
        tabIndex={-1}
        data-testid={TEST_IDS.worklist}
        className="bg-surface border border-border rounded p-6 outline-none focus:ring-2 focus:ring-accent"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-ink">Receivables Worklist</h2>
          <span className="text-xs uppercase font-medium text-muted px-2 py-0.5 bg-slate-50 border border-border rounded">
            Stage 3 Placeholder
          </span>
        </div>
        <p className="text-sm text-muted">
          Interactive collections worklist with invoice drawer, automated recovery proposals, and PayPal dispatch.
        </p>
      </div>

      {/* 6. Placeholder card: Impact (Stage 4 fills it) */}
      <div
        data-testid={TEST_IDS.impactCard}
        className="bg-surface border border-border rounded p-6"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-ink">Impact Summary</h2>
          <span className="text-xs uppercase font-medium text-muted px-2 py-0.5 bg-slate-50 border border-border rounded">
            Stage 4 Placeholder
          </span>
        </div>
        <p className="text-sm text-muted">
          Summary of cash recovered, reserve shortfall eliminated, and collection velocity metrics.
        </p>
      </div>
    </div>
  );
};
