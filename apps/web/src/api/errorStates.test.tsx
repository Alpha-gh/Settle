import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup';
import { KpiCards } from '../components/KpiCards';
import { AuditTimeline } from '../components/AuditTimeline';
import { PolicyForm } from '../components/PolicyForm';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

describe('Error-with-Retry States Verification', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockState.reset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderWithClient = (ui: React.ReactElement) =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );

  it('renders error state with retry on /api/kpis 500 failure and recovers on retry', async () => {
    // 1. Force 500
    server.use(
      http.get('/api/kpis', () => {
        return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    renderWithClient(<KpiCards />);

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.kpiError)).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId(TEST_IDS.kpiRetry);
    expect(retryBtn).toBeInTheDocument();

    // 2. Restore normal handler
    server.resetHandlers();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.kpiCash)).toBeInTheDocument();
    });
  });

  it('renders error state with retry on /api/audit 500 failure and recovers on retry', async () => {
    server.use(
      http.get('/api/audit', () => {
        return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    renderWithClient(<AuditTimeline />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load audit history/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    server.resetHandlers();
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.auditList)).toBeInTheDocument();
    });
  });

  it('renders error state with retry on /api/policy 500 failure and recovers on retry', async () => {
    server.use(
      http.get('/api/policy', () => {
        return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    renderWithClient(<PolicyForm />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load policy rules/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    server.resetHandlers();
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.policyForm)).toBeInTheDocument();
    });
  });
});
