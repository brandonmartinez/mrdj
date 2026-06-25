// Owner: Basher (realtime transport) — resolves O3 (SSE).
// See docs/slice-02-contract.md §1 and the broker ADR docs/decisions/realtime-broker.md (#18).
//
// Invalidation-signal pattern: the stream carries only a lightweight "queue changed"
// signal — never per-user data (balances). Clients re-fetch GET /events/:slug/queue,
// which is already per-user and authoritative.
//
// The publish/subscribe seam lives behind RealtimeService (./service.ts). This slice wires the
// in-process EventEmitter implementation (single replica); a Postgres LISTEN/NOTIFY implementation
// can be dropped in for multi-replica prod (#21) without changing any handler below.
import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { cfg } from '../config/index.js';
import { db, areas } from '../db/index.js';
import { getEventBySlug } from '../event/index.js';
import { sendError } from '../http/middleware.js';
import {
  InProcessRealtimeService, queueChannel,
  type RealtimeService, type QueueChangedEvent,
} from './service.js';
import { PgListenNotifyRealtimeService } from './pg-listen-notify.js';

// The active broker. Handlers stay transport-agnostic behind RealtimeService.
const realtime: RealtimeService = cfg.realtimeTransport === 'pg'
  ? new PgListenNotifyRealtimeService()
  : new InProcessRealtimeService();

const HEARTBEAT_MS = 25_000;

/** Notify subscribers of one Area that its queue changed. Safe to call post-commit. */
export function publishQueueChanged(eventId: string, areaId: string): void {
  realtime.publish(queueChannel(eventId, areaId), {
    type: 'queue:changed', eventId, areaId, at: new Date().toISOString(),
  });
}

/** Broadcast a change to every active area stream (used by non-area-scoped mutations
 *  like admin credit grants, where a user's balance — shown in the queue view — changed). */
export function publishAll(): void {
  const at = new Date().toISOString();
  realtime.broadcast({ type: 'queue:changed', at });
}

export async function disconnectRealtime(): Promise<void> {
  await realtime.disconnect();
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

  // Tell the browser how soon to reconnect after a drop (#28). Without this the UA picks an
  // arbitrary default; a fixed 3s keeps the reconnect window short and deterministic. On
  // reconnect the client re-fetches the full queue (EventSource.onopen), so nothing is missed.
  res.write('retry: 3000\n\n');

  // Initial hello so the client knows the stream is live.
  res.write(`event: hello\ndata: ${JSON.stringify({ eventId: event.id, areaId, at: new Date().toISOString() })}\n\n`);

  const onChange = (payload: QueueChangedEvent): void => {
    res.write(`event: queue\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const unsubscribe = realtime.subscribe(queueChannel(event.id, areaId), onChange);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}
