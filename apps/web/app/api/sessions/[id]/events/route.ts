import { gym, isRunning } from '@/lib/gym';
import { gymBus } from '@gym/engine';
import { toWireEvent } from '@/lib/serialize';
import type { GymEvent } from '@gym/engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/:id/events — Server-Sent Events for one session.
 *
 * Persisted events are replayed first, then the live stream is joined, so a
 * subscriber that arrives late still sees the whole workout in order and
 * never sees an event twice.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = gym().store;

  if (!store.getSession(id)) {
    return new Response(`No session "${id}"`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let highWater = -1;
      let closed = false;

      const send = (event: GymEvent): void => {
        if (closed || event.seq <= highWater) return;
        highWater = event.seq;
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(toWireEvent(event))}\n\n`),
        );
        if (event.type === 'SESSION_COMPLETED' || event.type === 'SESSION_FAILED') {
          close();
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      };

      // Open the stream with real bytes straight away. A browser will not
      // report an event stream as open until something arrives on it, and the
      // client waits for that before it starts the session.
      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      controller.enqueue(
        encoder.encode(`event: STREAM_READY\ndata: ${JSON.stringify({ sessionId: id })}\n\n`),
      );

      // Subscribe before replaying, so an event that lands mid-replay is not lost.
      unsubscribe = gymBus.subscribe(id, send);
      for (const event of store.listEvents(id)) send(event);

      // A finished session needs no stream; a pending one waits for /start.
      const session = store.getSession(id);
      if (session && session.status !== 'pending' && !isRunning(id) && session.finishedAt) {
        close();
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          close();
        }
      }, 15000);

      request.signal.addEventListener('abort', close);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Without this the response is gzipped, and gzip buffers the stream:
      // the browser then sees nothing until the session has already finished.
      'content-encoding': 'none',
      'x-accel-buffering': 'no',
    },
  });
}
