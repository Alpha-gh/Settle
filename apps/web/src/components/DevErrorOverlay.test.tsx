import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DevErrorOverlay } from './DevErrorOverlay';
import { dispatchDevSchemaError } from '../api/client';
import { TEST_IDS } from '../testids';

describe('DevErrorOverlay Component', () => {
  it('renders nothing when there is no schema error', () => {
    const { container } = render(<DevErrorOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a full-width overlay naming the endpoint and zod issues when triggered', () => {
    render(<DevErrorOverlay />);

    act(() => {
      dispatchDevSchemaError({
        endpoint: '/api/snapshot',
        issues: [
          {
            code: 'invalid_type',
            expected: 'number',
            received: 'string',
            path: ['business', 'startingBalance'],
            message: 'Expected number, received string',
          },
        ],
        rawData: { business: { startingBalance: 'corrupted_value' } },
      });
    });

    const overlay = screen.getByTestId(TEST_IDS.devErrorOverlay);
    expect(overlay).toBeInTheDocument();

    const endpoint = screen.getByTestId(TEST_IDS.devErrorOverlayEndpoint);
    expect(endpoint).toHaveTextContent('/api/snapshot');

    const details = screen.getByTestId(TEST_IDS.devErrorOverlayDetails);
    expect(details).toHaveTextContent('business.startingBalance: Expected number, received string');
  });

  it('can be dismissed by clicking the dismiss button', () => {
    render(<DevErrorOverlay />);

    act(() => {
      dispatchDevSchemaError({
        endpoint: '/api/kpis',
        issues: [
          {
            code: 'invalid_type',
            expected: 'number',
            received: 'null',
            path: ['cash'],
            message: 'Expected number, received null',
          },
        ],
        rawData: { cash: null },
      });
    });

    const dismissBtn = screen.getByTestId(TEST_IDS.devErrorOverlayDismiss);
    act(() => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.queryByTestId(TEST_IDS.devErrorOverlay)).not.toBeInTheDocument();
  });
});
