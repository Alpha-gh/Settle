import React from 'react';
import type { ForecastResult, Snapshot } from '@settle/shared';
import { formatUsd, formatDate } from '../lib/format';
import { TEST_IDS } from '../testids';

export interface BreachBannerProps {
  forecast: ForecastResult;
  snapshot?: Snapshot;
}

export const BreachBanner: React.FC<BreachBannerProps> = ({ forecast, snapshot }) => {
  if (!forecast.firstBreachDate) {
    return null;
  }

  const matchingObligation = snapshot?.obligations.find(
    (o) => o.dueDate === forecast.firstBreachDate,
  );

  const formattedDate = formatDate(forecast.firstBreachDate);
  const formattedShortfall = formatUsd(forecast.shortfall);

  const bannerText = matchingObligation
    ? `${matchingObligation.label} on ${formattedDate}: short ${formattedShortfall} under your reserve`
    : `Balance falls below your reserve on ${formattedDate}: short ${formattedShortfall}`;

  return (
    <div
      data-testid={TEST_IDS.breachBanner}
      role="alert"
      className="p-4 bg-status-red-bg text-status-red border border-status-red rounded flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-status-red flex-shrink-0" />
        <span className="text-sm font-semibold tracking-tight">{bannerText}</span>
      </div>
    </div>
  );
};

