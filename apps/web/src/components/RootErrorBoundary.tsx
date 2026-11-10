import React from 'react';

export interface RootErrorBoundaryProps {
  children: React.ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'An unexpected startup error occurred.';
    return { hasError: true, errorMessage: message };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[Settle RootErrorBoundary]:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="root-error-boundary"
          className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-white border border-red-200 rounded-lg p-6 shadow-sm space-y-4">
            <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600">
              Settle encountered an unexpected error while rendering the application.
            </p>
            {this.state.errorMessage && (
              <pre
                data-testid="root-error-message"
                className="text-xs font-mono bg-red-50 text-red-800 border border-red-200 rounded p-3 whitespace-pre-wrap break-words"
              >
                {this.state.errorMessage}
              </pre>
            )}
            <button
              type="button"
              data-testid="root-error-reload"
              onClick={this.handleReload}
              className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

