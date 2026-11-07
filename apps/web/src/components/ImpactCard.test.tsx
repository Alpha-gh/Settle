import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpactCard } from './ImpactCard';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

describe('ImpactCard Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockState.reset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <ImpactCard />
      </QueryClientProvider>,
    );

  it('renders empty state at baseline before any collection happens', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.impactEmpty)).toHaveTextContent('Run Settle to see impact');
    });
  });

  it('renders before vs after columns, invoices collected, and cash given up after payment simulation', async () => {
    // 1. Initial render at baseline captures "Before" forecast ($3,000.00 lowest, $2,000.00 shortfall)
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.impactEmpty)).toBeInTheDocument();
    });

    // 2. Simulate payment on inv_001 ($3,500.00)
    act(() => {
      mockState.simulatePayment('inv_001');
      queryClient.invalidateQueries();
    });

    await waitFor(() => {
      expect(screen.getByText('Recovery Impact')).toBeInTheDocument();
    });

    // Before values captured from initial session state
    expect(screen.getByTestId(TEST_IDS.impactBeforeLowest)).toHaveTextContent('$3,000.00');
    expect(screen.getByTestId(TEST_IDS.impactBeforeShortfall)).toHaveTextContent('$2,000.00');

    // After values: lowest balance improved to $6,325.00, shortfall eliminated to $0.00
    expect(screen.getByTestId(TEST_IDS.impactAfterLowest)).toHaveTextContent('$6,325.00');
    expect(screen.getByTestId(TEST_IDS.impactAfterShortfall)).toHaveTextContent('$0.00');
    expect(screen.getByText('Eliminated')).toBeInTheDocument();

    // Invoices collected: 1 invoice
    expect(screen.getByTestId(TEST_IDS.impactInvoicesCollected)).toHaveTextContent('1 invoice');
  });
});
