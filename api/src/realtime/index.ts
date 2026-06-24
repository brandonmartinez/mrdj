// Owner: Basher (realtime transport) — resolves O3 (SSE).
// See docs/slice-02-contract.md §1.
//
// Invalidation-signal pattern: the stream carries only a lightweight "queue changed"
// signal — never per-user data (balances). Clients re-fetch GET /events/:slug/queue,
// which is already per-user and authoritative.
//
// Broker = in-process EventEmitter (single process — the local/MVP deliverable). The
// publish/subscribe seam allows a Postgres LISTEN/NOTIFY broker for multi-replica prod
// later (note: PgBouncer transaction pooling can't LISTEN/NOTIFY — that listener needs a
// direct Postgres connection). Not built in this slice.
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { getEventBySlug } from '../event/index.js';
import { sendError } from '../http/middleware.js';

const bus = new EventEmitter();
// One process may fan out to many guest + console connections.
bus.setMaxListeners(0);

const HEARTBEAT_MS = 25_000;

function channel(eventId: string): string {
  return `queue:${eventId}`;
}

/** Notify all subscribers of one event that its queue changed. Safe to call post-commit. */
export function publishQueueChanged(eventId: string): void {
  bus.emit(channel(eventId), { type: 'queue:changed', eventId, at: new Date().toISOString() });
}

/** Broadcast a change to every active event stream (used by non-event-scoped mutations
 *  like admin credit grants, where a user's balance — shown in the queue view — changed). */
export function publishAll(): void {
  for (const name of bus.eventNames()) {
    if (typeof name === 'string' && name.startsWith('queue:')) {
      const eventId = name.slice('queue:'.length);
      publishQueueChanged(eventId);
    }
  }
}

// ── GET /api/events/:slug/stream ──────────────────────────────────────────────
export async function streamHandler(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection:      'keep-alive',
    // Disable proxy buffering (nginx/Traefik) so events flush immediately.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Initial hello so the client knows the stream is live.
  res.write(`event: hello\ndata: ${JSON.stringify({ eventId: event.id, at: new Date().toISOString() })}\n\n`);

  const onChange = (payload: unknown): void => {
    res.write(`event: queue\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const ch = channel(event.id);
  bus.on(ch, onChange);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    bus.off(ch, onChange);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}
