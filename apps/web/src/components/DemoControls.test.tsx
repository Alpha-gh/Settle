import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup';
import { DemoControls } from './DemoControls';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

describe('DemoControls Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    sessionStorage.clear();
    mockState.reset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderComponent = (initialEntries = ['/']) =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <DemoControls />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('renders nothing when demo mode is not enabled', () => {
    renderComponent(['/']);
    expect(screen.queryByTestId(TEST_IDS.demoPanel)).not.toBeInTheDocument();
  });

  it('renders demo panel when ?demo=1 query parameter is present', () => {
    renderComponent(['/?demo=1']);
    expect(screen.getByTestId(TEST_IDS.demoPanel)).toBeInTheDocument();
    expect(screen.getByText(/Demo Controls/i)).toBeInTheDocument();
  });

  it('renders demo panel when settle:demo=1 is present in sessionStorage', () => {
    sessionStorage.setItem('settle:demo', '1');
    renderComponent(['/']);
    expect(screen.getByTestId(TEST_IDS.demoPanel)).toBeInTheDocument();
  });

  it('handles reset confirmation flow properly', async () => {
    renderComponent(['/?demo=1']);

    const resetBtn = screen.getByTestId(TEST_IDS.demoReset);
    expect(resetBtn).toHaveTextContent(/Reset ledger/i);

    fireEvent.click(resetBtn);
    expect(screen.getByText('Confirm reset?')).toBeInTheDocument();

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(screen.getByTestId(TEST_IDS.demoReset)).toBeInTheDocument();

    // Now confirm reset
    fireEvent.click(screen.getByTestId(TEST_IDS.demoReset));
    fireEvent.click(screen.getByText('Yes, reset'));

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.demoReset)).toBeInTheDocument();
    });
  });

  it('triggers run agent button', async () => {
    renderComponent(['/?demo=1']);

    const runBtn = screen.getByTestId(TEST_IDS.demoRunAgent);
    expect(runBtn).toBeInTheDocument();
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(runBtn).toBeInTheDocument();
    });
  });

  it('calls reset then provision repeatedly until remaining is 0, displays progress, and disables buttons', async () => {
    let provCalls = 0;
    let releaseSecondCall!: () => void;
    const secondCallGate = new Promise<void>((resolve) => {
      releaseSecondCall = resolve;
    });

    server.use(
      http.post('/api/demo/reset', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
      http.post('/api/demo/provision-paypal', async () => {
        provCalls += 1;
        if (provCalls === 1) {
          return HttpResponse.json({
            provisioned: 8,
            skipped: 2,
            failed: 0,
            remaining: 4,
            failures: [],
          });
        }
        await secondCallGate;
        return HttpResponse.json({
          provisioned: 4,
          skipped: 10,
          failed: 0,
          remaining: 0,
          failures: [],
        });
      }),
    );

    renderComponent(['/?demo=1']);

    fireEvent.click(screen.getByTestId(TEST_IDS.demoReset));
    fireEvent.click(screen.getByText('Yes, reset'));

    await waitFor(() => {
      expect(screen.getByTestId('demo-provision-progress')).toHaveTextContent(
        'Setting up PayPal invoices: 8 of 12',
      );
    });
    expect(screen.getByTestId(TEST_IDS.demoRunAgent)).toBeDisabled();
    expect(screen.getByText('Yes, reset')).toBeDisabled();

    releaseSecondCall();

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.demoReset)).toBeInTheDocument();
    });
    expect(provCalls).toBe(2);
    expect(screen.getByTestId(TEST_IDS.demoRunAgent)).toBeEnabled();
  });

  it('caps provisioning loop at max 5 calls if remaining stays positive', async () => {
    let provCalls = 0;
    server.use(
      http.post('/api/demo/reset', () => HttpResponse.json({ status: 'ok' })),
      http.post('/api/demo/provision-paypal', () => {
        provCalls += 1;
        return HttpResponse.json({
          provisioned: 1,
          skipped: 0,
          failed: 0,
          remaining: 5,
          failures: [],
        });
      }),
    );

    renderComponent(['/?demo=1']);
    fireEvent.click(screen.getByTestId(TEST_IDS.demoReset));
    fireEvent.click(screen.getByText('Yes, reset'));

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.demoReset)).toBeInTheDocument();
    });
    expect(provCalls).toBe(5);
  });
});
