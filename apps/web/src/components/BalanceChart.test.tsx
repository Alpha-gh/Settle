import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceChart } from './BalanceChart';
import { TEST_IDS } from '../testids';
import { baselineForecast, afterPaymentForecast } from '../mocks/fixtures/forecast';

describe('BalanceChart Component', () => {
  it('renders chart container with accessible role="img" and detailed aria-label', () => {
    render(
      <BalanceChart
        forecast={baselineForecast}
        reserve={500000}
      />,
    );

    const chart = screen.getByTestId(TEST_IDS.balanceChart);
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute('role', 'img');

    // Aria label contains lowest amount, date and breach shortfall details
    const ariaLabel = chart.getAttribute('aria-label');
    expect(ariaLabel).toContain('30-day cash balance forecast');
    expect(ariaLabel).toContain('$3,000.00');
    expect(ariaLabel).toContain('Fri 6 Nov');
    expect(ariaLabel).toContain('shortfall');
  });

  it('renders a visually hidden fallback table for screen-readers', () => {
    render(
      <BalanceChart
        forecast={baselineForecast}
        reserve={500000}
      />,
    );

    const table = screen.getByTestId(TEST_IDS.chartFallbackTable);
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass('sr-only');

    // Contains all 30 days
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(30);
  });

  it('renders simulation badge when scenario overlay is provided', () => {
    render(
      <BalanceChart
        forecast={baselineForecast}
        reserve={500000}
        scenario={afterPaymentForecast}
        scenarioLabel="Discount scenario (5%)"
      />,
    );

    expect(screen.getByText(/Active simulation overlay/i)).toBeInTheDocument();
  });
});

