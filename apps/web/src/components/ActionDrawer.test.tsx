import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActionDrawer } from './ActionDrawer';
import { TEST_IDS } from '../testids';
import type { ActionRecord, Invoice, Payer, ActionStatus } from '@settle/shared';
import { mockScenarioComparison } from '../mocks/fixtures/forecast';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockInvoice: Invoice = {
  id: 'inv_101',
  payerId: 'pay_101',
  number: 'INV-1001',
  description: 'Test Invoice',
  amount: 250000,
  amountPaid: 0,
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  status: 'SENT',
  discountPct: 0,
  allowPartial: false,
};

const mockPayer: Payer = {
  id: 'pay_101',
  name: 'Acme Media',
  email: 'acme@test.com',
  persona: 'slow',
  avgDaysLate: 10,
  latenessRisk: 0.4,
};

const createMockAction = (status: ActionStatus, overrides: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'act_101',
  invoiceId: 'inv_101',
  type: 'OFFER_DISCOUNT',
  params: { discountPct: 5 },
  reason: 'Offer 5% discount to accelerate cashflow',
  policy: { allowed: true, requiresApproval: true, violations: [] },
  status,
  createdAt: '2026-11-02T10:00:00Z',
  ...overrides,
});

describe('ActionDrawer Component', () => {
  it('renders correctly when open and shows header details', () => {
    const action = createMockAction('AWAITING_APPROVAL', { simulation: mockScenarioComparison });
    render(
      <ActionDrawer
        isOpen={true}
        onClose={vi.fn()}
        action={action}
        invoice={mockInvoice}
        payer={mockPayer}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId(TEST_IDS.drawer)).toBeInTheDocument();
    expect(screen.getByText('INV-1001')).toBeInTheDocument();
    expect(screen.getByText(/Acme Media/)).toBeInTheDocument();
    expect(screen.getByText('$2,500.00')).toBeInTheDocument();
    expect(screen.getByTestId(TEST_IDS.drawerReason)).toHaveTextContent(
      'Offer 5% discount to accelerate cashflow',
    );
  });

  describe('Renders each of the seven statuses correctly', () => {
    it('1. AWAITING_APPROVAL: shows Approve and Reject buttons, no retry', () => {
      const action = createMockAction('AWAITING_APPROVAL');
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByTestId(TEST_IDS.approveButton)).toBeInTheDocument();
      expect(screen.getByTestId(TEST_IDS.rejectButton)).toBeInTheDocument();
      expect(screen.queryByTestId(TEST_IDS.retryButton)).not.toBeInTheDocument();
    });

    it('2. EXECUTED: shows PayPal request ID and "Executed via PayPal", NO approve button', () => {
      const action = createMockAction('EXECUTED', {
        paypalRequestId: 'PP-REQ-999',
        executedAt: '2026-11-02T11:00:00Z',
      });
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.queryByTestId(TEST_IDS.retryButton)).not.toBeInTheDocument();
      expect(screen.getByText('Executed via PayPal')).toBeInTheDocument();
      expect(screen.getByText(/PayPal Request: PP-REQ-999/)).toBeInTheDocument();
    });

    it('3. PROPOSED: shows "Proposed by agent", NO approve button', () => {
      const action = createMockAction('PROPOSED');
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.getByText('Proposed by agent')).toBeInTheDocument();
    });

    it('4. APPROVED: shows "Approved, waiting for PayPal", NO approve button', () => {
      const action = createMockAction('APPROVED', { decidedBy: 'owner' });
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.getByText('Approved, waiting for PayPal')).toBeInTheDocument();
    });

    it('5. REJECTED: shows "Rejected by owner", NO approve button', () => {
      const action = createMockAction('REJECTED', { decidedBy: 'owner' });
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.getByText('Rejected by owner')).toBeInTheDocument();
    });

    it('6. BLOCKED: shows policy violations, "Blocked by policy. Settle cannot override this.", NO approve button', () => {
      const action = createMockAction('BLOCKED', {
        policy: {
          allowed: false,
          requiresApproval: true,
          violations: ['Discount exceeds maximum allowed 5%'],
        },
      });
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.getByText('Blocked by policy. Settle cannot override this.')).toBeInTheDocument();
      expect(screen.getByText('Discount exceeds maximum allowed 5%')).toBeInTheDocument();
    });

    it('7. FAILED: shows error message, Retry button, NO approve button', () => {
      const action = createMockAction('FAILED', {
        error: 'PayPal API connection timed out',
      });
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByTestId(TEST_IDS.approveButton)).not.toBeInTheDocument();
      expect(screen.getByTestId(TEST_IDS.retryButton)).toBeInTheDocument();
      expect(screen.getByText('PayPal API connection timed out')).toBeInTheDocument();
    });
  });

  it('timeline shows PayPal request ID only when status is EXECUTED', () => {
    // 1. With APPROVED status, paypalRequestId should not appear
    const approvedAction = createMockAction('APPROVED', {
      paypalRequestId: 'SHOULD_NOT_SHOW',
    });
    const { rerender } = render(
      <ActionDrawer isOpen={true} onClose={vi.fn()} action={approvedAction} invoice={mockInvoice} />,
      { wrapper: createWrapper() },
    );
    expect(screen.queryByText(/PayPal Request:/)).not.toBeInTheDocument();

    // 2. With EXECUTED status, paypalRequestId appears
    const executedAction = createMockAction('EXECUTED', {
      paypalRequestId: 'PP-REQ-EX123',
    });
    rerender(
      <ActionDrawer isOpen={true} onClose={vi.fn()} action={executedAction} invoice={mockInvoice} />,
    );
    expect(screen.getByText(/PayPal Request: PP-REQ-EX123/)).toBeInTheDocument();
  });

  it('status text never contains "sent" or "paid" for non-EXECUTED/non-PAID states', () => {
    const action = createMockAction('AWAITING_APPROVAL');
    render(
      <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
      { wrapper: createWrapper() },
    );

    const timeline = screen.getByTestId(TEST_IDS.drawerTimeline);
    // The timeline wording must not claim sent or paid
    expect(timeline.textContent?.toLowerCase()).not.toContain('sent to paypal');
    expect(timeline.textContent?.toLowerCase()).not.toContain('invoice paid');
  });

  it('double click on Approve triggers exactly one request due to submission lock', async () => {
    let callCount = 0;
    const action = createMockAction('AWAITING_APPROVAL', { id: 'act_double_click_test' });

    // Mock fetch to track calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/actions/act_double_click_test/approve')) {
        callCount++;
        // Small artificial latency
        await new Promise((r) => setTimeout(r, 100));
        return new Response(
          JSON.stringify({
            ...action,
            status: 'APPROVED',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    });

    try {
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      const approveBtn = screen.getByTestId(TEST_IDS.approveButton);
      // Double click rapidly
      fireEvent.click(approveBtn);
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(callCount).toBe(1);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ActionDrawer
        isOpen={true}
        onClose={onClose}
        action={createMockAction('PROPOSED')}
        invoice={mockInvoice}
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId(TEST_IDS.drawerClose));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('FAILED status shows "Run Settle again" button and explanation sentence', () => {
    const action = createMockAction('FAILED', {
      error: 'PayPal API connection timed out',
    });
    render(
      <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
      { wrapper: createWrapper() },
    );

    const retryBtn = screen.getByTestId(TEST_IDS.retryButton);
    expect(retryBtn).toHaveTextContent('Run Settle again');
    expect(
      screen.getByText(
        'Running Settle again generates a fresh proposal reflecting the latest financial state.',
      ),
    ).toBeInTheDocument();
  });

  it('clicking "Run Settle again" triggers agent run mutation', async () => {
    let runCalled = false;
    const action = createMockAction('FAILED', { id: 'act_failed_test' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/agent/run')) {
        runCalled = true;
        return new Response(
          JSON.stringify({
            runId: 'run_123',
            actions: [],
            skipped: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input);
    });

    try {
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      fireEvent.click(screen.getByTestId(TEST_IDS.retryButton));

      await waitFor(() => {
        expect(runCalled).toBe(true);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('displays humanized message on 409 ACTION_NOT_OPEN mutation error', async () => {
    const action = createMockAction('AWAITING_APPROVAL', { id: 'act_not_open' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/actions/act_not_open/approve')) {
        return new Response(
          JSON.stringify({
            error: { code: 'ACTION_NOT_OPEN', message: 'Action not open' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input);
    });

    try {
      render(
        <ActionDrawer isOpen={true} onClose={vi.fn()} action={action} invoice={mockInvoice} />,
        { wrapper: createWrapper() },
      );

      fireEvent.click(screen.getByTestId(TEST_IDS.approveButton));

      await waitFor(() => {
        expect(
          screen.getByText('This action has already been resolved or closed.'),
        ).toBeInTheDocument();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

