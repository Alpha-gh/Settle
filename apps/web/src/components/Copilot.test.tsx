import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Copilot } from './Copilot';
import { TEST_IDS } from '../testids';

describe('Copilot Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderComponent = (props = { isOpen: true, onClose: vi.fn() }) =>
    render(
      <QueryClientProvider client={queryClient}>
        <Copilot {...props} />
      </QueryClientProvider>,
    );

  it('renders initial welcome message and suggested prompt chips', () => {
    renderComponent();

    expect(screen.getByText(/Cashflow Copilot/i)).toBeInTheDocument();
    expect(screen.getByText(/Hello. I am Settle Copilot/i)).toBeInTheDocument();

    expect(screen.getByTestId(TEST_IDS.chatSuggestion1)).toHaveTextContent('Can I cover the next payroll?');
    expect(screen.getByTestId(TEST_IDS.chatSuggestion2)).toHaveTextContent('What if I buy $3,000 of stock on Monday?');
    expect(screen.getByTestId(TEST_IDS.chatSuggestion3)).toHaveTextContent('Which invoice should I chase first?');
  });

  it('sends question via chat input and renders plain text answer with tool calls disclosure', async () => {
    renderComponent();

    const input = screen.getByTestId(TEST_IDS.copilotInput);
    const sendBtn = screen.getByTestId(TEST_IDS.copilotSend);

    fireEvent.change(input, { target: { value: 'Can I cover the next payroll?' } });
    fireEvent.click(sendBtn);

    // Thinking state should appear
    expect(screen.getByTestId(TEST_IDS.copilotThinking)).toBeInTheDocument();

    // After response finishes
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.copilotThinking)).not.toBeInTheDocument();
    });

    // Tool calls table disclosure exists
    const toolCalls = screen.getByTestId(TEST_IDS.copilotToolCalls);
    expect(toolCalls).toBeInTheDocument();
    expect(toolCalls).toHaveTextContent(/Tool calls/i);
    expect(toolCalls).toHaveTextContent('forecast');
  });

  it('sends question when clicking a suggested prompt chip', async () => {
    renderComponent();

    const chip1 = screen.getByTestId(TEST_IDS.chatSuggestion1);
    fireEvent.click(chip1);

    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.copilotThinking)).not.toBeInTheDocument();
    });

    // Verify response rendered verbatim
    expect(screen.getByText(/Under your baseline forecast/i)).toBeInTheDocument();
  });

  it('renders comparison chart and scenario metrics when response includes comparison', async () => {
    renderComponent();

    const chip1 = screen.getByTestId(TEST_IDS.chatSuggestion1);
    fireEvent.click(chip1);

    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.copilotThinking)).not.toBeInTheDocument();
    });

    // Verify metric row values from comparison
    expect(screen.getByText('Simulation Trajectory')).toBeInTheDocument();
    expect(screen.getByText('Cash Cost')).toBeInTheDocument();
    expect(screen.getByText('Lowest Δ')).toBeInTheDocument();
    expect(screen.getByText('Shortfall Δ')).toBeInTheDocument();
  });

  it('renders forecast chart when prompt returns standalone forecast', async () => {
    renderComponent();

    const chip2 = screen.getByTestId(TEST_IDS.chatSuggestion2);
    fireEvent.click(chip2);

    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.copilotThinking)).not.toBeInTheDocument();
    });

    // Stock prompt has forecast only, so "Projected Liquidity Trajectory" is rendered
    expect(screen.getByText('Projected Liquidity Trajectory')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderComponent({ isOpen: true, onClose });

    const closeBtn = screen.getByTestId(TEST_IDS.copilotClose);
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
