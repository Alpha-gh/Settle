import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PolicyForm } from './PolicyForm';
import { TEST_IDS } from '../testids';
import { mockState } from '../mocks/state';

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

describe('PolicyForm Component', () => {
  beforeEach(() => {
    mockState.reset();
  });

  it('loads and populates current policy settings from API', async () => {
    render(<PolicyForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.policyMaxDiscount)).toHaveValue(5);
      expect(screen.getByTestId(TEST_IDS.policyMaxInstalments)).toHaveValue(3);
      expect(screen.getByTestId(TEST_IDS.policyAutoApproveAmount)).toHaveValue('500.00');
    });

    // Save button is initially disabled because form is pristine (not dirty)
    expect(screen.getByTestId(TEST_IDS.policySave)).toBeDisabled();
  });

  it('validates invalid maxDiscountPct and invalid dollar input and blocks save', async () => {
    render(<PolicyForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.policyMaxDiscount)).toHaveValue(5);
    });

    // Enter invalid discount percentage (> 100)
    fireEvent.change(screen.getByTestId(TEST_IDS.policyMaxDiscount), {
      target: { value: '150' },
    });

    await waitFor(() => {
      expect(screen.getByText('Maximum allowed discount is 100%')).toBeInTheDocument();
    });

    expect(screen.getByTestId(TEST_IDS.policySave)).toBeDisabled();

    // Enter invalid dollar amount (more than 2 decimal places: 12.345)
    fireEvent.change(screen.getByTestId(TEST_IDS.policyAutoApproveAmount), {
      target: { value: '12.345' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Enter a valid dollar amount/i)).toBeInTheDocument();
    });

    expect(screen.getByTestId(TEST_IDS.policySave)).toBeDisabled();
  });

  it('submits valid changes with dollar amount converted to integer cents and shows success toast', async () => {
    render(<PolicyForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.policyMaxDiscount)).toHaveValue(5);
    });

    // Change discount to 8%
    fireEvent.change(screen.getByTestId(TEST_IDS.policyMaxDiscount), {
      target: { value: '8' },
    });

    // Change auto-approve to $750.50 (which equals 75050 cents)
    fireEvent.change(screen.getByTestId(TEST_IDS.policyAutoApproveAmount), {
      target: { value: '750.50' },
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.policySave)).toBeEnabled();
    });

    // Submit form
    fireEvent.click(screen.getByTestId(TEST_IDS.policySave));

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.toast)).toHaveTextContent('Policy saved');
    });

    // Confirm mockState was updated with integer cents
    expect(mockState.policy.maxDiscountPct).toBe(8);
    expect(mockState.policy.autoApproveMaxAmount).toBe(75050);
  });
});

