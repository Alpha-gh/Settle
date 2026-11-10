import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunSettleButton } from './RunSettleButton';
import { TEST_IDS } from '../testids';
import { ApiHttpError } from '../api/client';
import * as queries from '../api/queries';
import { mockAgentRunResult } from '../mocks/fixtures/actions';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual<typeof import('../api/queries')>('../api/queries');
  return {
    ...actual,
    useRunAgent: vi.fn(),
    useAgentStatus: vi.fn(),
  };
});

describe('RunSettleButton Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(queries.useAgentStatus).mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
    } as any);
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

  it('shows calm waiting message and polls /api/agent/status on 409 AGENT_RUN_IN_PROGRESS', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mockReset = vi.fn();
    const conflictError = new ApiHttpError('/api/agent/run', 409, 'Run already in progress', {
      error: {
        code: 'AGENT_RUN_IN_PROGRESS',
        startedAt: '2026-11-05T12:00:00.000Z',
        ageSeconds: 15,
      },
    });

    vi.mocked(queries.useRunAgent).mockReturnValue({
      mutate: vi.fn(),
      reset: mockReset,
      isPending: false,
      data: undefined,
      isError: true,
      error: conflictError,
    } as any);

    vi.mocked(queries.useAgentStatus).mockReturnValue({
      data: {
        running: true,
        startedAt: '2026-11-05T12:00:00.000Z',
        ageSeconds: 15,
      },
      dataUpdatedAt: Date.now() + 100,
    } as any);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId(TEST_IDS.runSettleError)).not.toBeInTheDocument();
    expect(screen.getByTestId(TEST_IDS.runSettleWaiting)).toHaveTextContent(
      'A run is already in progress, waiting...',
    );
    const button = screen.getByTestId(TEST_IDS.runSettle);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Settle is working...');
    expect(queries.useAgentStatus).toHaveBeenCalledWith(true);

    // Status poll returns running: false -> refreshes dashboard & actions and clears waiting
    vi.mocked(queries.useAgentStatus).mockReturnValue({
      data: { running: false, startedAt: null, ageSeconds: 0 },
      dataUpdatedAt: Date.now() + 2000,
    } as any);

    rerender(
      <QueryClientProvider client={queryClient}>
        <RunSettleButton />
      </QueryClientProvider>,
    );

    expect(mockReset).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queries.QUERY_KEYS.dashboard });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queries.QUERY_KEYS.actions });
    expect(screen.queryByTestId(TEST_IDS.runSettleWaiting)).not.toBeInTheDocument();
  });
});

