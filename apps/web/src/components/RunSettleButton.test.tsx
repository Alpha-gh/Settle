import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunSettleButton } from './RunSettleButton';
import { TEST_IDS } from '../testids';
import * as queries from '../api/queries';
import { mockAgentRunResult } from '../mocks/fixtures/actions';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual<typeof import('../api/queries')>('../api/queries');
  return {
    ...actual,
    useRunAgent: vi.fn(),
  };
});

describe('RunSettleButton Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('renders enabled button in idle state and triggers mutation on click', () => {
    const mockMutate = vi.fn();
    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: undefined,
      isError: false,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    const button = screen.getByTestId(TEST_IDS.runSettle);
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Run Settle');

    fireEvent.click(button);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('disables button and displays indeterminate progress bar while pending', () => {
    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      data: undefined,
      isError: false,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    const button = screen.getByTestId(TEST_IDS.runSettle);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Settle is working...');

    const progress = screen.getByTestId(TEST_IDS.runSettleProgress);
    expect(progress).toBeInTheDocument();
  });

  it('prevents double-clicking and does not fire multiple mutation calls', () => {
    const mockMutate = vi.fn();
    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: undefined,
      isError: false,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    const button = screen.getByTestId(TEST_IDS.runSettle);

    // Rapid double click
    fireEvent.click(button);
    fireEvent.click(button);

    // Because the component guards with isExecutingRef, only the first call proceeds
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('renders success result line and worklist focus link upon completion', () => {
    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: mockAgentRunResult,
      isError: false,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    const resultNotice = screen.getByTestId(TEST_IDS.runSettleResult);
    expect(resultNotice).toBeInTheDocument();
    expect(resultNotice).toHaveTextContent('7 actions proposed, 1 invoice skipped.');
    expect(screen.getByRole('link', { name: /Review actions/i })).toBeInTheDocument();
  });

  it('renders error state with retry button on failure', () => {
    const mockMutate = vi.fn();
    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      data: undefined,
      isError: true,
      error: new Error('Agent run failed: timeout'),
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    const errorNotice = screen.getByTestId(TEST_IDS.runSettleError);
    expect(errorNotice).toBeInTheDocument();
    expect(errorNotice).toHaveTextContent('Agent run failed: timeout');

    const retryBtn = screen.getByTestId(TEST_IDS.runSettleRetry);
    fireEvent.click(retryBtn);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});

