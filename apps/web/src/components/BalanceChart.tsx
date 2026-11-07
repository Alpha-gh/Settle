import React, { useMemo } from 'react';
import { AgCharts } from 'ag-charts-react';
import type { AgChartOptions } from 'ag-charts-community';
import type { ForecastResult, Cents } from '@settle/shared';
import { formatUsd, formatDate, formatDateShort } from '../lib/format';
import { TEST_IDS } from '../testids';

export interface BalanceChartProps {
  forecast: ForecastResult;
  reserve: Cents;
  scenario?: ForecastResult;
  scenarioLabel?: string;
  height?: number;
  compact?: boolean;
}

interface ChartDatum {
  date: string;
  receipts: number;
  outflows: number;
  closing: number;
  reserve: number;
  belowReserve: boolean;
  scenarioClosing?: number;
}

export const BalanceChart: React.FC<BalanceChartProps> = ({
  forecast,
  reserve,
  scenario,
  scenarioLabel = 'Scenario simulation',
  height = 360,
  compact = false,
}) => {
  // Construct accessible summary text for aria-label
  const ariaSummary = useMemo(() => {
    const lowestDate = formatDate(forecast.lowest.date);
    const lowestAmount = formatUsd(forecast.lowest.amount);
    const breachInfo = forecast.firstBreachDate
      ? `First reserve breach occurs on ${formatDate(forecast.firstBreachDate)} with ${formatUsd(forecast.shortfall)} shortfall.`
      : 'Cash balance remains above the reserve threshold throughout the entire 30-day forecast horizon.';

    return `30-day cash balance forecast: lowest closing point is ${lowestAmount} on ${lowestDate}. ${breachInfo}`;
  }, [forecast]);

  // Transform forecast days and optional scenario into chart data rows
  const chartData: ChartDatum[] = useMemo(() => {
    const scenarioMap = new Map<string, number>();
    if (scenario?.days) {
      for (const sDay of scenario.days) {
        scenarioMap.set(sDay.date, sDay.closing);
      }
    }

    return forecast.days.map((day) => {
      const datum: ChartDatum = {
        date: day.date,
        receipts: day.receipts,
        outflows: day.outflows,
        closing: day.closing,
        reserve,
        belowReserve: day.belowReserve,
      };

      if (scenarioMap.has(day.date)) {
        datum.scenarioClosing = scenarioMap.get(day.date);
      }

      return datum;
    });
  }, [forecast.days, reserve, scenario]);

  const chartOptions: AgChartOptions = useMemo(() => {
    return {
      data: chartData,
      theme: {
        palette: {
          fills: ['#0F172A', '#64748B', '#1D4ED8'],
          strokes: ['#0F172A', '#64748B', '#1D4ED8'],
        },
      },
      series: [
        // 1. Closing balance line (ink #0F172A)
        {
          type: 'line',
          xKey: 'date',
          yKey: 'closing',
          yName: 'Closing Balance',
          stroke: '#0F172A',
          strokeWidth: 2,
          marker: {
            enabled: true,
            size: 6,
            itemStyler: (params) => {
              const datum = params.datum as ChartDatum | undefined;
              if (datum?.belowReserve) {
                return {
                  fill: '#B91C1C',
                  stroke: '#7F1D1D',
                  strokeWidth: 1.5,
                  size: 8,
                };
              }
              // Normal non-breach days have no visible marker
              return { size: 0 };
            },
          },
          tooltip: {
            renderer: (params) => {
              const d = params.datum as ChartDatum;
              const title = formatDate(d.date);
              const receiptsText = formatUsd(d.receipts);
              const outflowsText = formatUsd(d.outflows);
              const closingText = formatUsd(d.closing);

              return {
                title,
                content: `Receipts: ${receiptsText}<br/>Outflows: ${outflowsText}<br/>Closing: ${closingText}`,
              };
            },
          },
        },
        // 2. Reserve threshold line (dashed muted #475569)
        {
          type: 'line',
          xKey: 'date',
          yKey: 'reserve',
          yName: 'Reserve Threshold',
          stroke: '#64748B',
          strokeWidth: 1.5,
          lineDash: [6, 4],
          marker: { enabled: false },
          tooltip: {
            renderer: () => ({
              title: 'Reserve Threshold',
              content: `Policy Reserve: ${formatUsd(reserve)}`,
            }),
          },
        },
        // 3. Scenario series in accent color (#1D4ED8)
        ...(scenario
          ? [
              {
                type: 'line' as const,
                xKey: 'date',
                yKey: 'scenarioClosing',
                yName: scenarioLabel,
                stroke: '#1D4ED8',
                strokeWidth: 2,
                marker: {
                  enabled: false,
                },
                tooltip: {
                  renderer: (params: { datum: unknown }) => {
                    const d = params.datum as ChartDatum;
                    return {
                      title: `${scenarioLabel} — ${formatDate(d.date)}`,
                      content: `Projected Closing: ${d.scenarioClosing !== undefined ? formatUsd(d.scenarioClosing) : '—'}`,
                    };
                  },
                },
              },
            ]
          : []),
      ],
      axes: [
        {
          type: 'category',
          position: 'bottom',
          label: {
            formatter: ({ value }: { value: string }) => formatDateShort(value),
            fontSize: compact ? 10 : 12,
            color: '#475569',
          },
          line: { stroke: '#E2E8F0' },
          gridLine: { enabled: false },
        },
        {
          type: 'number',
          position: 'left',
          label: {
            formatter: ({ value }: { value: number }) => formatUsd(value),
            fontSize: compact ? 10 : 12,
            color: '#475569',
          },
          line: { stroke: '#E2E8F0' },
          gridLine: {
            style: [{ stroke: '#F1F5F9', lineDash: [2, 2] }],
          },
        },
      ],
      legend: {
        enabled: true,
        position: 'bottom',
        item: {
          label: {
            color: '#0F172A',
            fontSize: 12,
          },
        },
      },
    };
  }, [chartData, compact, reserve, scenario, scenarioLabel]);

  return (
    <div
      data-testid={TEST_IDS.balanceChart}
      role="img"
      aria-label={ariaSummary}
      className="w-full bg-surface p-4 rounded border border-border"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-base font-semibold text-ink">30-Day Liquidity Trajectory</h2>
          <p className="text-xs text-muted">
            Daily balance forecast with reserve guardrail and potential breach markers
          </p>
        </div>
        {scenario && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-accent border border-blue-200 rounded text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-accent" />
            Active simulation overlay
          </span>
        )}
      </div>

      <div style={{ height: `${height}px`, width: '100%' }}>
        <AgCharts options={chartOptions} />
      </div>

      {/* Screen-reader accessible tabular fallback */}
      <table
        data-testid={TEST_IDS.chartFallbackTable}
        className="sr-only"
        aria-label="30-day forecast daily balance data table"
      >
        <caption>Detailed daily receipts, outflows, and closing balance breakdown</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Receipts</th>
            <th scope="col">Outflows</th>
            <th scope="col">Closing Balance</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {forecast.days.map((day) => (
            <tr key={day.date}>
              <td>{formatDate(day.date)}</td>
              <td>{formatUsd(day.receipts)}</td>
              <td>{formatUsd(day.outflows)}</td>
              <td>{formatUsd(day.closing)}</td>
              <td>{day.belowReserve ? 'Below reserve threshold' : 'Above reserve'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

