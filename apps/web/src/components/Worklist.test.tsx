import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Worklist } from './Worklist';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

function createWrapper(initialEntries = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Worklist Component', () => {
  beforeEach(() => {
    mockState.reset();
  });

  it('renders worklist container', async () => {
    render(<Worklist />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.worklist)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('renders 8 invoice rows from snapshot fixtures', async () => {
    render(<Worklist />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(screen.getByTestId('worklist-row-inv_001')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_002')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_003')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_004')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_005')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_006')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_007')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_008')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('renders all 7 action statuses and 1 "No action" after agent run', async () => {
    // Populate mock actions
    mockState.runAgent();

    render(<Worklist />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        // 8 rows present
        expect(screen.getByTestId('worklist-row-inv_001')).toBeInTheDocument();
        expect(screen.getByTestId('worklist-row-inv_008')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Check that various action statuses are displayed in the document
    await waitFor(
      () => {
        // AWAITING_APPROVAL on inv_001
        expect(screen.getByText(/Offer discount — Awaiting approval/i)).toBeInTheDocument();
        // EXECUTED on inv_007
        expect(screen.getByText(/Offer discount — Executed/i)).toBeInTheDocument();
        // PROPOSED on inv_002
        expect(screen.getByText(/Remind — Proposed/i)).toBeInTheDocument();
        // APPROVED on inv_003
        expect(screen.getByText(/Offer instalments — Approved/i)).toBeInTheDocument();
        // REJECTED on inv_004
        expect(screen.getByText(/Offer discount — Rejected/i)).toBeInTheDocument();
        // BLOCKED on inv_005
        expect(screen.getByText(/Offer discount — Blocked/i)).toBeInTheDocument();
        // FAILED on inv_006
        expect(screen.getByText(/Escalate — Failed/i)).toBeInTheDocument();
        // No action on inv_008
        expect(screen.getByText('No action')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('opens ActionDrawer when ?action=act_001 is set in URL', async () => {
    mockState.runAgent();

    render(<Worklist />, { wrapper: createWrapper(['/?action=act_001']) });

    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.drawer)).toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.approveButton)).toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.drawerReason)).toHaveTextContent(
          'Accelerates receipt to Nov 6, eliminating the $2,000 payroll reserve shortfall.',
        );
      },
      { timeout: 5000 },
    );
  });

  it('opens read-only ActionDrawer when ?invoice=inv_008 is set in URL', async () => {
    mockState.runAgent();

    render(<Worklist />, { wrapper: createWrapper(['/?invoice=inv_008']) });

    await waitFor(
      () => {
        const drawer = screen.getByTestId(TEST_IDS.drawer);
        expect(drawer).toBeInTheDocument();
        expect(within(drawer).getByText('INV-1008')).toBeInTheDocument();
        // No approve button on read-only invoice without action
        expect(within(drawer).queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
        expect(within(drawer).getByText('No simulation attached')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});

