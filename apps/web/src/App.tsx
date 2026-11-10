import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SseProvider } from './api/sse';
import { BreachMemoryProvider } from './state/breachMemory';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ReceivablesPage } from './pages/ReceivablesPage';
import { AuditPage } from './pages/AuditPage';
import { PolicyPage } from './pages/PolicyPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <SseProvider>
        <BreachMemoryProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="receivables" element={<ReceivablesPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="policy" element={<PolicyPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </BreachMemoryProvider>
      </SseProvider>
    </QueryClientProvider>
  );
};

export default App;

