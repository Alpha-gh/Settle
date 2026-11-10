import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCards } from './KpiCards';
import { TEST_IDS } from '../testids';
import * as queries from '../api/queries';
import { baselineKpis, afterPaymentKpis } from '../mocks/fixtures/kpis';

vi.mock('../api/queries', () => ({
  useKpis: vi.fn(),
}));

describe('KpiCards Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders skeleton cards while loading', () => {
    vi.mocked(queries.useKpis).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<KpiCards />);
    expect(screen.getByTestId(TEST_IDS.kpiSkeleton)).toBeInTheDocument();
  });

  it('renders error alert with retry button when query fails', () => {
    const mockRefetch = vi.fn();
    vi.mocked(queries.useKpis).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Failed to fetch KPIs'),
      refetch: mockRefetch,
    } as any);

    render(<KpiCards />);
    const errorBox = screen.getByTestId(TEST_IDS.kpiError);
    expect(errorBox).toBeInTheDocument();
    expect(errorBox).toHaveTextContent('Failed to fetch KPIs');

    const retryBtn = screen.getByTestId(TEST_IDS.kpiRetry);
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders KPI values formatted with integer cents and tabular numerals, turning red on breach', () => {
    vi.mocked(queries.useKpis).mockReturnValue({
      data: baselineKpis,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<KpiCards />);

    // 1. Cash today: $9,800.00
    const cashCard = screen.getByTestId(TEST_IDS.kpiCash);
    expect(cashCard).toHaveTextContent('$9,800.00');

    // 2. Lowest balance: $3,000.00 on Fri 6 Nov
    const lowestCard = screen.getByTestId(TEST_IDS.kpiLowest);
    expect(lowestCard).toHaveTextContent('$3,000.00');
    expect(lowestCard).toHaveTextContent('on Fri 6 Nov');

    // 3. Shortfall: $2,000.00 (turns red because shortfall > 0)
    const shortfallCard = screen.getByTestId(TEST_IDS.kpiShortfall);
    expect(shortfallCard).toHaveTextContent('$2,000.00');
    expect(shortfallCard).toHaveClass('bg-status-red-bg');
    expect(shortfallCard).toHaveClass('border-status-red');

    // 4. Overdue total: $17,200.00 (8 invoices)
    const overdueCard = screen.getByTestId(TEST_IDS.kpiOverdue);
    expect(overdueCard).toHaveTextContent('$17,200.00');
    expect(overdueCard).toHaveTextContent('8 invoices (19d avg)');
  });

  it('renders green shortfall card when shortfall is 0 (gap closed)', () => {
    vi.mocked(queries.useKpis).mockReturnValue({
      data: afterPaymentKpis,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<KpiCards />);

    const shortfallCard = screen.getByTestId(TEST_IDS.kpiShortfall);
    expect(shortfallCard).toHaveTextContent('$0.00');
    expect(shortfallCard).not.toHaveClass('bg-status-red-bg');
  });
});

