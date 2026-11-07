import React, { useRef, useEffect } from 'react';
import { useSnapshot, useForecast, useActions, useImpact } from '../api/queries';
import { formatUsd } from '../lib/format';
import { TEST_IDS } from '../testids';
import type { Cents } from '@settle/shared';

export const ImpactCard: React.FC = () => {
  const { data: snapshot, isLoading: loadingSnapshot } = useSnapshot();
  const { data: forecast, isLoading: loadingForecast } = useForecast();
  const { data: actions = [], isLoading: loadingActions } = useActions();
  const { data: impactSummary, isLoading: loadingImpact } = useImpact();

  // Baseline "Before" memory: preserve the first forecast values seen in this session
  const baselineLowestRef = useRef<Cents | null>(null);
  const baselineShortfallRef = useRef<Cents | null>(null);

  useEffect(() => {
    if (forecast && baselineLowestRef.current === null) {
      baselineLowestRef.current = forecast.lowest.amount;
      baselineShortfallRef.current = forecast.shortfall;
    }
  }, [forecast]);

  const isLoading = loadingSnapshot || loadingForecast || loadingActions || loadingImpact;

  if (isLoading) {
    return (
      <div
        data-testid={TEST_IDS.impactCard}
        className="bg-surface border border-border rounded p-6 space-y-4 animate-pulse"
      >
        <div className="h-6 w-36 bg-slate-200 rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="h-16 bg-slate-100 rounded" />
          <div className="h-16 bg-slate-100 rounded" />
          <div className="h-16 bg-slate-100 rounded" />
          <div className="h-16 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  // Derive counts from API data
  const paidInvoices = snapshot?.invoices.filter((i) => i.status === 'PAID') ?? [];
  const executedActions = actions.filter((a) => a.status === 'EXECUTED');

  // Cash given up in discounts: sum of simulation.cashCost over EXECUTED actions (plain summation)
  const cashGivenUpInDiscounts = executedActions.reduce((sum, a) => {
    return sum + (a.simulation?.cashCost ?? 0);
  }, 0);

  const beforeLowest = baselineLowestRef.current ?? forecast?.lowest.amount ?? 300000;
  const beforeShortfall = baselineShortfallRef.current ?? forecast?.shortfall ?? 200000;

  const afterLowest = forecast?.lowest.amount ?? beforeLowest;
  const afterShortfall = forecast?.shortfall ?? beforeShortfall;

  // Has any collection or action execution occurred?
  const hasCollectionActivity =
    paidInvoices.length > 0 ||
    executedActions.length > 0 ||
    (impactSummary && (impactSummary.actionsExecuted > 0 || impactSummary.cashRecovered > 0));

  // Empty state before any collection happens
  if (!hasCollectionActivity) {
    return (
      <div
        data-testid={TEST_IDS.impactCard}
        className="bg-surface border border-border rounded p-8 text-center space-y-2"
      >
        <h2 className="text-base font-semibold text-ink">Impact Summary</h2>
        <p
          data-testid={TEST_IDS.impactEmpty}
          className="text-sm text-muted max-w-md mx-auto"
        >
          Run Settle to see impact
        </p>
      </div>
    );
  }

  // Improved checks (compare only, no business arithmetic)
  const lowestImproved = afterLowest > beforeLowest;
  const shortfallImproved = afterShortfall < beforeShortfall;

  return (
    <div
      data-testid={TEST_IDS.impactCard}
      className="bg-surface border border-border rounded p-6 space-y-6"
    >
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-base font-bold text-ink tracking-tight">Recovery Impact</h2>
          <p className="text-xs text-muted mt-0.5">
            Demonstrated before-and-after variance across liquidity guardrails and collections
          </p>
        </div>
        <span className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-green-50 text-green-900 border border-green-300">
          Verified Impact
        </span>
      </div>

      {/* Proof Frame Table: Large, legible, still (no animation) */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider font-semibold text-muted bg-slate-50">
              <th className="py-2.5 px-4">Metric</th>
              <th className="py-2.5 px-4 text-right">Before</th>
              <th className="py-2.5 px-4 text-right">After</th>
              <th className="py-2.5 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Lowest Balance Row */}
            <tr>
              <td className="py-3 px-4 font-medium text-ink">Lowest Balance</td>
              <td
                data-testid={TEST_IDS.impactBeforeLowest}
                className="py-3 px-4 text-right tabular text-muted"
              >
                {formatUsd(beforeLowest)}
              </td>
              <td
                data-testid={TEST_IDS.impactAfterLowest}
                className={`py-3 px-4 text-right tabular font-bold ${
                  lowestImproved ? 'text-green-700 bg-green-50/50' : 'text-ink'
                }`}
              >
                {formatUsd(afterLowest)}
              </td>
              <td className="py-3 px-4 text-center">
                {lowestImproved ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-800 border border-green-200">
                    Improved
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs text-muted bg-slate-100">
                    Baseline
                  </span>
                )}
              </td>
            </tr>

            {/* Shortfall Row */}
            <tr>
              <td className="py-3 px-4 font-medium text-ink">Projected Reserve Shortfall</td>
              <td
                data-testid={TEST_IDS.impactBeforeShortfall}
                className="py-3 px-4 text-right tabular text-red-700"
              >
                {formatUsd(beforeShortfall)}
              </td>
              <td
                data-testid={TEST_IDS.impactAfterShortfall}
                className={`py-3 px-4 text-right tabular font-bold ${
                  shortfallImproved ? 'text-green-700 bg-green-50/50' : 'text-red-700'
                }`}
              >
                {formatUsd(afterShortfall)}
              </td>
              <td className="py-3 px-4 text-center">
                {shortfallImproved && afterShortfall === 0 ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-800 border border-green-200">
                    Eliminated
                  </span>
                ) : shortfallImproved ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-800 border border-green-200">
                    Reduced
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs text-status-red bg-red-50">
                    Shortfall Active
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Auxiliary Metrics: Invoices Collected & Cash Given Up in Discounts */}
      <div className="grid grid-cols-2 gap-4 pt-2">
        <div className="p-4 bg-slate-50 border border-border rounded flex flex-col justify-between">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Invoices Collected
          </span>
          <div
            data-testid={TEST_IDS.impactInvoicesCollected}
            className="text-2xl font-bold text-ink mt-2 tabular"
          >
            {paidInvoices.length} {paidInvoices.length === 1 ? 'invoice' : 'invoices'}
          </div>
          <span className="text-[11px] text-muted mt-1">Paid and settled via gateway</span>
        </div>

        <div className="p-4 bg-slate-50 border border-border rounded flex flex-col justify-between">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Cash Given Up (Discounts)
          </span>
          <div
            data-testid={TEST_IDS.impactCashDiscounts}
            className="text-2xl font-bold text-ink mt-2 tabular"
          >
            {formatUsd(cashGivenUpInDiscounts)}
          </div>
          <span className="text-[11px] text-muted mt-1">Settlement concession cost</span>
        </div>
      </div>
    </div>
  );
};

