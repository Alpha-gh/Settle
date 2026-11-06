import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

async function prepareApp() {
  // Rule 7: One env var switches mock/real: VITE_API_BASE.
  // Unset or empty = start MSW and the in-memory mock event bus.
  // Set = call that base URL and use EventSource.
  if (!import.meta.env.VITE_API_BASE) {
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

prepareApp().then(() => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found in document.');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

