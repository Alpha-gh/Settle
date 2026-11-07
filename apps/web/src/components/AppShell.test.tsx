import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './AppShell';
import { TEST_IDS } from '../testids';

describe('AppShell', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const renderShell = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('renders the permanent sandbox badge per Rule 1', () => {
    renderShell();

    const badge = screen.getByTestId(TEST_IDS.sandboxBadge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/Sandbox - no real funds/i);
  });

  it('renders navigation links for Dashboard, Receivables, Audit Log, and Policy Rules', () => {
    renderShell();

    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Receivables/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Audit Log/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Policy Rules/i })).toBeInTheDocument();
  });

  it('renders the connection status indicator', () => {
    renderShell();

    const connectionIndicator = screen.getByTestId(TEST_IDS.connectionStatus);
    expect(connectionIndicator).toBeInTheDocument();
  });

  it('renders the Copilot toggle button in header', () => {
    renderShell();

    const copilotBtn = screen.getByTestId(TEST_IDS.copilotToggle);
    expect(copilotBtn).toBeInTheDocument();
  });
});
