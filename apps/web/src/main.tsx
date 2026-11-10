import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import './index.css';

async function prepareApp() {
  // Start MSW only when explicitly enabled via VITE_USE_MOCKS=true.
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: {
        url: '/mockServiceWorker.js',
      },
    });
    console.info('[Settle System 4] MSW started in browser mock mode.');
  }
}

function renderApp(startupError?: unknown) {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found in document.');
  }

  const ThrowStartupError: React.FC = () => {
    throw startupError instanceof Error ? startupError : new Error(String(startupError));
  };

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RootErrorBoundary>{startupError ? <ThrowStartupError /> : <App />}</RootErrorBoundary>
    </React.StrictMode>,
  );
}

prepareApp().then(
  () => renderApp(),
  (err) => {
    console.error('[Settle] Application startup failed:', err);
    renderApp(err);
  },
);

