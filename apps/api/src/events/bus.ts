import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SseEvent } from '@settle/shared';

class SseEventBus extends EventEmitter {
  private clientCount = 0;

  emitEvent(event: SseEvent): void {
    this.emit('sse', event);
  }

  onEvent(handler: (event: SseEvent) => void): () => void {
    this.on('sse', handler);
    return () => {
      this.off('sse', handler);
    };
  }

  handleSseConnection(req: FastifyRequest, reply: FastifyReply): void {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    });

    this.clientCount++;
    req.log.info({ clients: this.clientCount }, 'SSE client connected');

    // Send initial connection comment
    reply.raw.write(': connected\n\n');

    const listener = (event: SseEvent) => {
      try {
        const data = JSON.stringify(event.payload);
        reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
      } catch (err) {
        req.log.error({ err }, 'Error sending SSE event');
      }
    };

    this.on('sse', listener);

    // 15-second heartbeat comment
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.off('sse', listener);
      this.clientCount = Math.max(0, this.clientCount - 1);
      req.log.info({ clients: this.clientCount }, 'SSE client disconnected');
    };

    req.raw.on('close', cleanup);
    req.raw.on('end', cleanup);
    reply.raw.on('close', cleanup);
  }

  getActiveClientCount(): number {
    return this.clientCount;
  }
}

export const eventBus = new SseEventBus();

