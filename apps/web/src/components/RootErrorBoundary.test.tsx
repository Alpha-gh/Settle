import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RootErrorBoundary } from './RootErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ThrowingComponent = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('RootErrorBoundary', () => {
  it('renders children cleanly when there is no error', () => {
    render(
      <RootErrorBoundary>
        <div>Healthy App</div>
      </RootErrorBoundary>,
    );
    expect(screen.getByText('Healthy App')).toBeInTheDocument();
  });

  it('renders visible error panel with error message and Reload button when startup fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RootErrorBoundary>
        <ThrowingComponent message="Failed to initialize Settle UI" />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId('root-error-boundary')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByTestId('root-error-message')).toHaveTextContent(
      'Failed to initialize Settle UI',
    );
    const reloadBtn = screen.getByTestId('root-error-reload');
    expect(reloadBtn).toHaveTextContent('Reload');

    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    fireEvent.click(reloadBtn);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

