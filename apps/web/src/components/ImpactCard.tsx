import React, { useState, useEffect } from 'react';
import { useDashboard, useActions } from '../api/queries';
import { formatUsd } from '../lib/format';
import { TEST_IDS } from '../testids';
import type { Cents } from '@settle/shared';

interface BaselineState {
  lowest: Cents;
  shortfall: Cents;
}

export const ImpactCard: React.FC = () => {
  const { data: dashboard, isLoading: loadingDashboard } = useDashboard();
  const { data: actions = [], isLoading: loadingActions } = useActions();

  const businessId = dashboard?.business?.id;
  const asOf = dashboard?.business?.asOf;
  const storageKey = businessId
    ? `settle:baseline:${businessId}:${asOf ?? ''}`
    : 'settle:baseline:default';

  // Read baseline from sessionStorage on mount / key change
  const [baseline, setBaseline] = useState<BaselineState | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const forecast = dashboard?.forecast;
  const invoices = dashboard?.invoices ?? [];

  // Capture baseline from initial forecast when a breach is present and no actions have executed
  useEffect(() => {
    if (!forecast) return;

    const executedActions = actions.filter((a) => a.status === 'EXECUTED');
    const isBreach = forecast.shortfall > 0 || forecast.firstBreachDate !== null;

    // When there are no executed actions and a breach is present, this is our true baseline
    if (executedActions.length === 0 && isBreach) {
      const captured: BaselineState = {
        lowest: forecast.lowest.amount,
        shortfall: forecast.shortfall,
      };
      setBaseline(captured);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(captured));
      } catch {
        // ignore
      }
    }
  }, [forecast, actions, storageKey]);

  const isLoading = loadingDashboard || loadingActions;

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
  const paidInvoices = invoices.filter((i) => i.status === 'PAID');
  const executedActions = actions.filter((a) => a.status === 'EXECUTED');
  const approvedOrExecutedActions = actions.filter(
    (a) => a.status === 'EXECUTED' || a.status === 'APPROVED',
  );

  // Cash given up: sum of discount amounts from EXECUTED actions (or approved actions about to execute)
  const cashGivenUpInDiscounts = approvedOrExecutedActions.reduce((sum, a) => {
    if (a.type === 'OFFER_DISCOUNT') {
      return sum + (a.simulation?.cashCost ?? 0);
    }
    return sum;
  }, 0);

  // Has any collection or action execution occurred?
  const hasCollectionActivity = paidInvoices.length > 0 || executedActions.length > 0;

  // Empty state when no actions proposed yet, or no activity yet, or no baseline
  if (!hasCollectionActivity || !baseline || !forecast) {
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

  const beforeLowest = baseline.lowest;
  const beforeShortfall = baseline.shortfall;
  const afterLowest = forecast.lowest.amount;
  const afterShortfall = forecast.shortfall;

  const lowestImproved = afterLowest > beforeLowest;
  const shortfallImproved = afterShortfall < beforeShortfall;
  const gapClosed = afterLowest >= 0 || (afterShortfall === 0 && beforeShortfall > 0);

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
          {gapClosed ? 'Gap Closed' : 'Verified Impact'}
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
