import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuditTimeline } from './AuditTimeline';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AuditTimeline Component', () => {
  beforeEach(() => {
    mockState.reset();
  });

  it('renders audit list sorted newest first', async () => {
    render(<AuditTimeline />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(screen.getByTestId('audit-event-aud_003')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const eventNodes = screen.getAllByTestId(/^audit-event-/);
    expect(eventNodes.length).toBe(3);

    // Newest first: aud_003 (08:10) -> aud_002 (08:05) -> aud_001 (08:00)
    expect(eventNodes[0]).toHaveAttribute('data-testid', 'audit-event-aud_003');
    expect(eventNodes[1]).toHaveAttribute('data-testid', 'audit-event-aud_002');
    expect(eventNodes[2]).toHaveAttribute('data-testid', 'audit-event-aud_001');
  });

  it('filters events by actor when filter chips are clicked', async () => {
    render(<AuditTimeline />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.auditFilter('paypal'))).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Baseline contains paypal (aud_002) and system (aud_001, aud_003)
    expect(screen.getByTestId('audit-event-aud_001')).toBeInTheDocument();
    expect(screen.getByTestId('audit-event-aud_002')).toBeInTheDocument();
    expect(screen.getByTestId('audit-event-aud_003')).toBeInTheDocument();

    // Click PayPal filter
    fireEvent.click(screen.getByTestId(TEST_IDS.auditFilter('paypal')));

    // Only aud_002 should remain
    expect(screen.getByTestId('audit-event-aud_002')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-event-aud_001')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-event-aud_003')).not.toBeInTheDocument();

    // Click All filter to restore
    fireEvent.click(screen.getByTestId(TEST_IDS.auditFilter('all')));
    expect(screen.getByTestId('audit-event-aud_001')).toBeInTheDocument();
    expect(screen.getByTestId('audit-event-aud_002')).toBeInTheDocument();
    expect(screen.getByTestId('audit-event-aud_003')).toBeInTheDocument();
  });

  it('displays PayPal request ID in monospace tag when an event has paypalRequestId', async () => {
    // Add an audit event with paypalRequestId
    mockState.audit = [
      {
        id: 'aud_pp_01',
        ts: '2026-11-02T12:00:00Z',
        actor: 'paypal',
        kind: 'action.executed',
        summary: 'PayPal executed invoice discount',
        paypalRequestId: 'PP-REQ-7F3A91',
      },
      ...mockState.audit,
    ];

    render(<AuditTimeline />, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(screen.getByText(/PayPal: PP-REQ-7F3A91/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});
