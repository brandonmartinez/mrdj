// Owner: Basher (realtime transport) — RealtimeService contract (ADR: docs/decisions/realtime-broker.md, #18).
//
// The SSE transport publishes a lightweight "queue changed" *signal* per Area; clients re-fetch the
// authoritative per-user queue view over REST. This module defines the broker seam behind that signal
// so the in-process EventEmitter (MVP, single replica) can be swapped for a Postgres LISTEN/NOTIFY
// broker (multi-replica prod, #21) without touching any handler.

/** The only payload shape carried on a realtime channel. Intentionally data-free beyond identifiers
 *  and a timestamp — never per-user data (balances/pricing), which clients fetch over REST. */
export interface QueueChangedEvent {
  type:    'queue:changed';
  eventId?: string;
  areaId?:  string;
  at:       string;
}

/** Unsubscribe handle returned by subscribe(); idempotent. */
export type Unsubscribe = () => void;

/**
 * Broker abstraction for the SSE fan-out. Implementations:
 *  - InProcessRealtimeService — EventEmitter, single process (MVP / this slice).
 *  - PgListenNotifyRealtimeService — Postgres LISTEN/NOTIFY for multi-replica fan-out (#21).
 *
 * A LISTEN/NOTIFY implementation MUST hold a dedicated, direct Postgres connection (NOT routed through
 * PgBouncer transaction pooling, which cannot LISTEN) and translate NOTIFY payloads back into
 * QueueChangedEvent before invoking local subscribers — see the ADR for the full rationale.
 */
export interface RealtimeService {
  /** Subscribe a handler to a channel. Returns an idempotent unsubscribe. */
  subscribe(channel: string, handler: (payload: QueueChangedEvent) => void): Unsubscribe;
  /** Publish an event to a channel's subscribers (and, in a NOTIFY impl, peer replicas). */
  publish(channel: string, payload: QueueChangedEvent): void;
  /** Broadcast an event to all queue channel subscribers (and, in a NOTIFY impl, peer replicas). */
  broadcast(payload: QueueChangedEvent): void;
  /** Currently active channel names. */
  channelNames(): string[];
  /** Release transport resources (timers, sockets, listeners). Safe to call once at shutdown. */
  disconnect(): Promise<void>;
}

// ── Channel naming convention (per-area scoping, #25/#70/#91) ──────────────────
// Format: `queue:<eventId>:<areaId>`. The `queue:` prefix namespaces realtime channels so a
// non-area-scoped broadcast can cheaply select them; eventId scopes to a tenant's event; areaId
// makes each Area an independent fan-out so multi-area events never cross-notify. The NOTIFY impl
// hashes this logical name to a short Postgres channel because identifiers are capped at 63 bytes.

const QUEUE_CHANNEL_PREFIX = 'queue:';

/** Build the realtime channel name for one Area's queue. */
export function queueChannel(eventId: string, areaId: string): string {
  return `${QUEUE_CHANNEL_PREFIX}${eventId}:${areaId}`;
}

/** True for channel names produced by queueChannel(). */
export function isQueueChannel(name: string): boolean {
  return name.startsWith(QUEUE_CHANNEL_PREFIX);
}

// ── In-process implementation (MVP, single replica) ───────────────────────────
import { EventEmitter } from 'node:events';

export class InProcessRealtimeService implements RealtimeService {
  private readonly bus = new EventEmitter();

  constructor() {
    // One process fans out to many guest + console connections; no listener cap.
    this.bus.setMaxListeners(0);
  }

  subscribe(channel: string, handler: (payload: QueueChangedEvent) => void): Unsubscribe {
    const listener = (payload: QueueChangedEvent) => handler(payload);
    this.bus.on(channel, listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.bus.off(channel, listener);
    };
  }

  publish(channel: string, payload: QueueChangedEvent): void {
    this.bus.emit(channel, payload);
  }

  broadcast(payload: QueueChangedEvent): void {
    for (const name of this.channelNames()) {
      if (isQueueChannel(name)) {
        this.bus.emit(name, payload);
      }
    }
  }

  channelNames(): string[] {
    return this.bus.eventNames().filter((n): n is string => typeof n === 'string');
  }

  async disconnect(): Promise<void> {
    this.bus.removeAllListeners();
  }
}
