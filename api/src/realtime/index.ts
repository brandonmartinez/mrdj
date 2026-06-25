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
import { and, eq } from 'drizzle-orm';
import { db, areas } from '../db/index.js';
import { getEventBySlug } from '../event/index.js';
import { sendError } from '../http/middleware.js';

const bus = new EventEmitter();
// One process may fan out to many guest + console connections.
bus.setMaxListeners(0);

const HEARTBEAT_MS = 25_000;

// Channels are scoped to an Area so multi-area events fan out independently (#25/#70/#91).
function channel(eventId: string, areaId: string): string {
  return `queue:${eventId}:${areaId}`;
}

/** Notify subscribers of one Area that its queue changed. Safe to call post-commit. */
export function publishQueueChanged(eventId: string, areaId: string): void {
  bus.emit(channel(eventId, areaId), { type: 'queue:changed', eventId, areaId, at: new Date().toISOString() });
}

/** Broadcast a change to every active area stream (used by non-area-scoped mutations
 *  like admin credit grants, where a user's balance — shown in the queue view — changed). */
export function publishAll(): void {
  for (const name of bus.eventNames()) {
    if (typeof name === 'string' && name.startsWith('queue:')) {
      bus.emit(name, { type: 'queue:changed', at: new Date().toISOString() });
    }
  }
}

// ── GET /api/events/:slug/stream ──────────────────────────────────────────────
export async function streamHandler(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;
  const areaIdParam = typeof req.query.areaId === 'string' ? req.query.areaId : undefined;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  // Resolve the Area to subscribe to: an explicit ?areaId= (must belong to the event) or
  // the event's default Area. An unknown area falls back to the default so a stale client
  // never 404s the long-lived connection.
  let areaId = event.default_area_id;
  if (areaIdParam) {
    const [row] = await db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.id, areaIdParam), eq(areas.eventId, event.id))).limit(1);
    if (row) areaId = row.id;
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
  res.write(`event: hello\ndata: ${JSON.stringify({ eventId: event.id, areaId, at: new Date().toISOString() })}\n\n`);

  const onChange = (payload: unknown): void => {
    res.write(`event: queue\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const ch = channel(event.id, areaId);
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
