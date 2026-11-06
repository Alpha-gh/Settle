import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { TEST_IDS } from '../testids';

describe('AppShell', () => {
  it('renders the permanent sandbox badge per Rule 1', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    const badge = screen.getByTestId(TEST_IDS.sandboxBadge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/Sandbox - no real funds/i);
  });

  it('renders navigation links for Dashboard, Receivables, Audit Log, and Policy Rules', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Receivables/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Audit Log/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Policy Rules/i })).toBeInTheDocument();
  });

  it('renders the connection status indicator', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    const connectionIndicator = screen.getByTestId(TEST_IDS.connectionStatus);
    expect(connectionIndicator).toBeInTheDocument();
  });
});
