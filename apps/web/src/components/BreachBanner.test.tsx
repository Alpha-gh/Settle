import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreachBanner } from './BreachBanner';
import { TEST_IDS } from '../testids';
import type { ForecastResult, Snapshot } from '@settle/shared';
import { baselineForecast, afterPaymentForecast } from '../mocks/fixtures/forecast';
import { baselineSnapshot } from '../mocks/fixtures/snapshot';

describe('BreachBanner Component', () => {
  it('renders null when forecast has no breach (firstBreachDate is null)', () => {
    const { container } = render(
      <BreachBanner forecast={afterPaymentForecast} snapshot={baselineSnapshot} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('selects the matching obligation from snapshot data when multiple obligations exist', () => {
    // Snapshot with two distinct obligations
    const customSnapshot: Snapshot = {
      ...baselineSnapshot,
      obligations: [
        {
          id: 'obl_rent',
          label: 'Studio Rent December',
          kind: 'rent',
          amount: 250000,
          dueDate: '2026-11-20',
        },
        {
          id: 'obl_payroll',
          label: 'Payroll Bi-weekly',
          kind: 'payroll',
          amount: 1200000,
          dueDate: '2026-11-06',
        },
      ],
    };

    render(<BreachBanner forecast={baselineForecast} snapshot={customSnapshot} />);

    const banner = screen.getByTestId(TEST_IDS.breachBanner);
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    // Correct obligation label chosen and formatted with date and shortfall
    expect(banner).toHaveTextContent(
      'Payroll Bi-weekly on Fri 6 Nov: short $2,000.00 under your reserve',
    );
  });

  it('falls back to generic balance breach text when no obligation matches firstBreachDate', () => {
    const forecastWithUnmatchedBreach: ForecastResult = {
      ...baselineForecast,
      firstBreachDate: '2026-11-10', // Date with no obligation in snapshot
      shortfall: 150000,
    };

    render(
      <BreachBanner forecast={forecastWithUnmatchedBreach} snapshot={baselineSnapshot} />,
    );

    const banner = screen.getByTestId(TEST_IDS.breachBanner);
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      'Balance falls below your reserve on Tue 10 Nov: short $1,500.00',
    );
  });
});

