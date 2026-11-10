import type { SseEvent } from '@settle/shared';

export type EventListener = (event: SseEvent) => void;

class MockEventBus {
  private listeners: Set<EventListener> = new Set();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: SseEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[MockEventBus error]:', err);
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export const mockEventBus = new MockEventBus();

