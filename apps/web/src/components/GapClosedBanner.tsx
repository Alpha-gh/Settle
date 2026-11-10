import React from 'react';
import type { ForecastResult } from '@settle/shared';
import { formatUsd, formatDate } from '../lib/format';
import { TEST_IDS } from '../testids';

export interface GapClosedBannerProps {
  forecast: ForecastResult;
  hadBreach: boolean;
}

export const GapClosedBanner: React.FC<GapClosedBannerProps> = ({ forecast, hadBreach }) => {
  // Only display if the session previously saw a breach and the latest forecast has cleared it
  if (!hadBreach || forecast.firstBreachDate !== null) {
    return null;
  }

  const lowestFormatted = formatUsd(forecast.lowest.amount);
  const lowestDateFormatted = formatDate(forecast.lowest.date);

  return (
    <div
      data-testid={TEST_IDS.gapClosedBanner}
      role="status"
      className="p-4 bg-status-green-bg text-status-green border border-status-green rounded flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-status-green flex-shrink-0" />
        <div className="text-sm">
          <span className="font-semibold">
            Gap closed: your balance now stays above your reserve.
          </span>{' '}
          <span className="font-normal opacity-90">
            Lowest balance: <strong className="tabular">{lowestFormatted}</strong> on{' '}
            {lowestDateFormatted}.
          </span>
        </div>
      </div>
    </div>
  );
};

