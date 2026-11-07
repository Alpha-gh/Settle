import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { BreachMemoryProvider } from '../state/breachMemory';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

describe('DashboardPage Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockState.reset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });
  });

  const renderDashboard = (initialUrl = '/') => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BreachMemoryProvider>
          <MemoryRouter initialEntries={[initialUrl]}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
            </Routes>
          </MemoryRouter>
        </BreachMemoryProvider>
      </QueryClientProvider>,
    );
  };

  it('renders breach banner, KPI values matching baseline fixtures, and chart', async () => {
    renderDashboard('/');

    // Wait for baseline data to load
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.breachBanner)).toBeInTheDocument();
    });

    // 1. Red breach banner text derived from obligation matching firstBreachDate
    const breachBanner = screen.getByTestId(TEST_IDS.breachBanner);
    expect(breachBanner).toHaveTextContent(
      'Payroll November (Bi-weekly) on Fri 6 Nov: short $2,000.00 under your reserve',
    );

    // 2. KPI values matching baseline fixtures
    expect(screen.getByTestId(TEST_IDS.kpiCash)).toHaveTextContent('$9,800.00');
    expect(screen.getByTestId(TEST_IDS.kpiLowest)).toHaveTextContent('$3,000.00');
    expect(screen.getByTestId(TEST_IDS.kpiLowest)).toHaveTextContent('on Fri 6 Nov');
    expect(screen.getByTestId(TEST_IDS.kpiShortfall)).toHaveTextContent('$2,000.00');
    expect(screen.getByTestId(TEST_IDS.kpiOverdue)).toHaveTextContent('$17,200.00');

    // 3. Balance chart rendered with aria summary
    const chart = screen.getByTestId(TEST_IDS.balanceChart);
    expect(chart).toBeInTheDocument();
    expect(chart.getAttribute('aria-label')).toContain('shortfall');
  });

  it('clicking Run Settle disables button and displays result line upon completion', async () => {
    renderDashboard('/');

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.runSettle)).toBeInTheDocument();
    });

    const runButton = screen.getByTestId(TEST_IDS.runSettle);
    expect(runButton).toBeEnabled();

    fireEvent.click(runButton);

    // Wait for mutation to complete and result line to appear
    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.runSettleResult)).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    expect(screen.getByTestId(TEST_IDS.runSettleResult)).toHaveTextContent(
      '7 actions proposed, 1 invoice skipped.',
    );
  }, 15000);

  it('shows scenario simulation overlay when ?action=act_001 is set, and hides when param is absent', async () => {
    // Populate state with actions
    mockState.runAgent();

    // 1. With action param pointing to act_001 (which has simulation)
    const { unmount } = renderDashboard('/?action=act_001');

    await waitFor(() => {
      expect(screen.getByText(/Active simulation overlay/i)).toBeInTheDocument();
    });

    unmount();

    // 2. Without action param
    renderDashboard('/');

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.balanceChart)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Active simulation overlay/i)).not.toBeInTheDocument();
  });
});

