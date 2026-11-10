import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SseEvent, ActionRecord, AuditEvent } from '@settle/shared';
import { sseEventSchema, type DashboardResponse } from './schemas';
import { mockEventBus } from './bus';
import { QUERY_KEYS } from './queries';
import { ENDPOINTS } from './endpoints';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface SseContextValue {
  connectionState: ConnectionState;
}

const SseContext = createContext<SseContextValue>({
  connectionState: 'disconnected',
});

export const useSse = () => useContext(SseContext);

/**
 * Connects to live SSE in real mode or subscribes to in-memory bus in mock mode.
 * Returns a cleanup disposer function.
 */
export function connectEvents(
  onEvent: (event: SseEvent) => void,
  onStateChange?: (state: ConnectionState) => void,
): () => void {
  const apiBase = import.meta.env.VITE_API_BASE;

  // Mock mode: subscribe to in-memory event bus
  if (!apiBase) {
    onStateChange?.('connected');
    const unsubscribe = mockEventBus.subscribe((rawEvent) => {
      const parsed = sseEventSchema.safeParse(rawEvent);
      if (parsed.success) {
        onEvent(parsed.data);
      } else {
        console.warn('[SSE Mock validation error]:', parsed.error);
      }
    });
    return () => {
      onStateChange?.('disconnected');
      unsubscribe();
    };
  }

  // Real mode: standard EventSource with reconnect
  onStateChange?.('connecting');
  const sseUrl = `${apiBase}${ENDPOINTS.events()}`;
  let eventSource: EventSource | null = new EventSource(sseUrl);
  let isDisposed = false;

  eventSource.onopen = () => {
    if (!isDisposed) onStateChange?.('connected');
  };

  eventSource.onerror = () => {
    if (!isDisposed) {
      onStateChange?.('connecting');
    }
  };

  eventSource.onmessage = (e) => {
    try {
      const raw = JSON.parse(e.data);
      const parsed = sseEventSchema.safeParse(raw);
      if (parsed.success) {
        onEvent(parsed.data);
      } else {
        console.error('[SSE Parse Error]:', parsed.error, raw);
      }
    } catch (err) {
      console.error('[SSE JSON Parse Error]:', err);
    }
  };

  return () => {
    isDisposed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    onStateChange?.('disconnected');
  };
}

export interface SseProviderProps {
  children: ReactNode;
}

export const SseProvider: React.FC<SseProviderProps> = ({ children }) => {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const handleEvent = (event: SseEvent) => {
      switch (event.type) {
        case 'invoice.updated': {
          const updatedInvoice = event.payload;
          queryClient.setQueryData<DashboardResponse>(QUERY_KEYS.dashboard, (old) => {
            if (!old) return old;
            return {
              ...old,
              invoices: old.invoices.map((inv) =>
                inv.id === updatedInvoice.id ? updatedInvoice : inv,
              ),
            };
          });
          break;
        }

        case 'action.updated': {
          const updatedAction = event.payload;
          queryClient.setQueryData<ActionRecord[]>(QUERY_KEYS.actions, (old = []) => {
            const exists = old.some((a) => a.id === updatedAction.id);
            if (exists) {
              return old.map((a) => (a.id === updatedAction.id ? updatedAction : a));
            }
            return [...old, updatedAction];
          });
          break;
        }

        case 'audit.appended': {
          const newAudit = event.payload;
          queryClient.setQueryData<AuditEvent[]>(QUERY_KEYS.audit, (old = []) => [
            newAudit,
            ...old,
          ]);
          break;
        }

        case 'forecast.updated': {
          const updatedForecast = event.payload;
          queryClient.setQueryData<DashboardResponse>(QUERY_KEYS.dashboard, (old) => {
            if (!old) return old;
            return {
              ...old,
              forecast: updatedForecast,
            };
          });
          // Invalidate KPIs and impact when forecast updates
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.impact });
          break;
        }
      }
    };

    const cleanup = connectEvents(handleEvent, setConnectionState);
    return cleanup;
  }, [queryClient]);

  return (
    <SseContext.Provider value={{ connectionState }}>
      {children}
    </SseContext.Provider>
  );
};

