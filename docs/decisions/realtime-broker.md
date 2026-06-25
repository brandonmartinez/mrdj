# Realtime Broker Architecture — Decision O3 (LISTEN/NOTIFY)

> **Summary:** The SSE transport publishes a lightweight *"queue changed"* signal per Area; clients
> re-fetch the authoritative queue view over REST. For the MVP (single replica) the broker is an
> in-process `EventEmitter`. For multi-replica production we will adopt **Postgres LISTEN/NOTIFY**
> behind a stable `RealtimeService` interface, using a **dedicated direct (non-PgBouncer) Postgres
> connection** per replica and the channel convention `queue:<eventId>:<areaId>`. Sticky sessions are
> **not required** because every replica subscribes to every relevant channel and the client always
> re-syncs full state over REST on reconnect.

---

## Context

mrdj guests watch a live jukebox queue. When anything changes (a track is added, boosted, played, or
Play Next is locked) every connected guest + DJ console for that Area must see it within ~1s. We use
**Server-Sent Events (SSE)** for the push channel (`GET /api/events/:slug/stream`).

Per the **invalidation-signal pattern** (`docs/slice-02-contract.md` §1) the stream never carries
per-user data (balances, pricing). It carries only a tiny `queue:changed` signal; the client responds
by re-fetching `GET /api/events/:slug/queue`, which is already per-user and server-authoritative. This
keeps the broker payload trivial and means the broker never has to know about money or identity.

**Current state (MVP, this slice):** the broker is an in-process `EventEmitter`. `publishQueueChanged`
emits on a per-Area channel; each open SSE response subscribes to its Area's channel. This is correct
and simple **for a single process**. It does **not** survive horizontal scaling: a mutation handled by
replica A emits only to replica A's emitter, so guests connected to replica B never get the signal.

**This ADR** defines how we cross that gap, and locks the **interface seam** (`RealtimeService`) so the
swap is a one-line binding change with no handler edits.

### Hard requirements

1. **Multi-replica fan-out** — a mutation on any replica must reach SSE clients on *all* replicas.
2. **Per-Area scoping** — multi-area events (#25/#70/#91) must fan out independently; an Area's signal
   must not wake clients watching a different Area.
3. **No missed updates across reconnect** — already solved on the client (#28): `EventSource.onopen`
   re-fetches the full queue, so a dropped/rebalanced connection self-heals.
4. **No new infrastructure for MVP** — Postgres is already a hard dependency; reuse it rather than
   adding Redis/NATS/Kafka before we need them.
5. **Pluggable** — the transport must sit behind an interface so MVP and prod differ by one binding.

---

## Options Considered

| Option | Multi-replica | New infra | Ordering / delivery | Ops burden | Verdict |
|--------|--------------|-----------|---------------------|------------|---------|
| **In-process EventEmitter** | ❌ single process only | none | in-order, at-most-once, in-proc | none | ✅ MVP only |
| **Postgres LISTEN/NOTIFY** | ✅ via shared DB | none (reuse Postgres) | per-connection FIFO, at-most-once | low | ✅ **chosen for prod** |
| **Redis Pub/Sub** | ✅ | Redis cluster | at-most-once | medium | ➖ overkill pre-scale |
| **NATS / Kafka** | ✅ | broker cluster | strong, replayable | high | ❌ YAGNI |
| **Sticky sessions + in-proc** | ⚠️ partial | LB config | in-proc | medium | ❌ fragile (see below) |

### Why Postgres LISTEN/NOTIFY

- **Zero new infrastructure.** Postgres is already the system of record. `NOTIFY <channel>, <payload>`
  + `LISTEN <channel>` gives us a cross-replica pub/sub bus for free.
- **At-most-once is fine.** Our signal is *idempotent and data-free* — a missed or duplicated
  `queue:changed` just triggers a redundant REST re-fetch that dedups via JSON-diff on the client.
  We do not need durability, replay, or exactly-once. This is exactly the delivery guarantee NOTIFY
  provides, so the weakest-acceptable guarantee matches the cheapest transport.
- **Transactional alignment.** `NOTIFY` issued inside the same transaction as the mutation is delivered
  only if the transaction commits — no "signal sent but write rolled back" races. (We currently publish
  *post-commit* from app code; a NOTIFY impl may instead fire NOTIFY in-transaction for tighter
  semantics — both are acceptable since the client re-reads authoritative state.)

### Why **not** sticky sessions

Sticky sessions (pin a guest to one replica so the in-process emitter suffices) were rejected:

- **Doesn't actually solve fan-out.** A mutation on replica A still has to reach a guest pinned to
  replica B. Stickiness pins *clients*, not *writes* — you'd still need cross-replica delivery for the
  publisher side, which is the whole problem.
- **Rebalancing breaks it.** Deploys, autoscaling, and replica restarts move clients between replicas.
  Each move drops the SSE connection — fine for us because of #28's reconnect re-sync, but it means you
  can never rely on the pin holding, so you can't lean on it for correctness.
- **Couples app correctness to LB config.** We'd be one Traefik/ingress misconfiguration away from
  silently dropping updates. LISTEN/NOTIFY keeps correctness inside the app + DB.

**Conclusion:** stickiness is neither necessary nor sufficient. With LISTEN/NOTIFY every replica hears
every signal, so any client can connect to any replica. Sticky routing is **not required**.

---

## Decision

### ✅ Postgres LISTEN/NOTIFY behind a `RealtimeService` interface

1. **Interface seam (shipped now).** All handlers talk to `RealtimeService` (`api/src/realtime/service.ts`).
   The MVP binds `InProcessRealtimeService`; prod will bind a `PgListenNotifyRealtimeService`. No handler
   changes — only the single `const realtime: RealtimeService = …` binding in `api/src/realtime/index.ts`.

2. **Dedicated direct connection (non-PgBouncer).** The LISTEN/NOTIFY implementation MUST hold its own
   long-lived Postgres connection that bypasses **PgBouncer transaction-pooling**. In transaction-pooling
   mode a session's `LISTEN` registration is lost when the pooled connection is handed to another client,
   so notifications are silently dropped. The listener therefore connects **directly to Postgres** (or to
   PgBouncer in *session*-pooling mode on a dedicated pool). Normal request/transaction traffic continues
   to go through PgBouncer as usual — only the listener socket is special.

3. **Per-replica listener, app-local fan-out.** Each replica opens one direct connection and `LISTEN`s on
   the relevant channels. On `NOTIFY`, the listener parses the payload back into a `QueueChangedEvent` and
   re-publishes it to that replica's *local* subscribers (the open SSE responses). Publishing a change =
   one `NOTIFY` (in the request's normal pooled connection); every replica's listener receives it and fans
   out locally. This is the standard "DB as message bus, in-proc as last-hop" topology.

4. **Channel naming (per-Area scoping).** `queue:<eventId>:<areaId>`. The `queue:` prefix namespaces
   realtime channels (so a non-area-scoped broadcast can cheaply enumerate them); `eventId` scopes to a
   tenant's event; `areaId` makes each Area an independent fan-out. Identifiers are UUIDs (ASCII + hyphens),
   so a name is ~80 chars — **but** Postgres channel identifiers are capped at **63 bytes (NAMEDATALEN-1)**.
   The NOTIFY implementation therefore maps the logical channel to a Postgres channel by **hashing**
   (e.g. `q_` + a short stable hash of `eventId:areaId`) and carries the full `{eventId, areaId}` in the
   **NOTIFY payload** (payload limit 8000 bytes — ample for our tiny JSON). Subscribers match on the
   payload's `areaId`, so the hash only needs to be collision-resistant enough to bound fan-out, not
   unique. The logical-channel API (`queueChannel(eventId, areaId)`) is unchanged for callers either way.

5. **Reconnect / backoff strategy.**
   - **Client → server (SSE):** the server emits `retry: 3000`, so browsers reconnect ~3s after a drop;
     `EventSource.onopen` then re-fetches the full queue (#28) → no missed updates, no duplicates. Native
     `EventSource` already applies exponential-ish backoff under repeated failures; the `retry` hint sets
     the floor. A low-frequency REST fallback poll (15s) is the final backstop if SSE is unavailable.
   - **Listener → Postgres:** the replica's `LISTEN` connection reconnects with **capped exponential
     backoff** (e.g. 0.5s → 1s → 2s → … → 30s cap, with jitter). Critically, **on every listener
     reconnect the replica must assume it missed NOTIFYs during the gap** and trigger a local
     re-broadcast so its SSE clients re-sync — i.e. it `publishAll()`s once after re-establishing LISTEN.
     This mirrors the client's onopen re-fetch one layer down and keeps the at-most-once transport
     correct across DB blips.

---

## `RealtimeService` Interface Contract

Defined in `api/src/realtime/service.ts` (shipped this slice; in-process impl wired):

```ts
interface QueueChangedEvent {
  type:    'queue:changed';
  eventId?: string;  // omitted on a non-area-scoped broadcast (publishAll)
  areaId?:  string;
  at:       string;  // ISO-8601
}

type Unsubscribe = () => void;

interface RealtimeService {
  subscribe(channel: string, handler: (payload: QueueChangedEvent) => void): Unsubscribe;
  publish(channel: string, payload: QueueChangedEvent): void;
  channelNames(): string[];          // active channels — used to fan a global change to every stream
  disconnect(): Promise<void>;       // release timers/sockets/listeners at shutdown
}

// Channel-naming helpers (the only sanctioned way to build/recognise channels):
function queueChannel(eventId: string, areaId: string): string; // `queue:<eventId>:<areaId>`
function isQueueChannel(name: string): boolean;
```

**Implementations**

- `InProcessRealtimeService` — `EventEmitter`, single process. **MVP, shipped.**
- `PgListenNotifyRealtimeService` — *(future, #21)* holds a direct Postgres connection; `subscribe`
  registers a local handler (and ensures a `LISTEN` on the mapped PG channel); `publish` issues `NOTIFY`;
  the listener translates inbound NOTIFYs to local handler invocations; `disconnect` tears down the socket.
  On listener reconnect it re-broadcasts to recover missed signals.

The handler-facing API (`publishQueueChanged`, `publishAll`, `streamHandler`) is identical across
implementations — they only ever touch `RealtimeService` + the channel helpers.

---

## Consequences

**Positive**

- MVP ships today on the in-process broker with zero new infra; the prod path is unblocked and de-risked
  because the interface + channel convention are frozen and already in use.
- No Redis/Kafka to run, secure, or pay for until scale genuinely demands it.
- Correctness never depends on load-balancer stickiness.

**Negative / watch-items**

- LISTEN/NOTIFY requires a **direct** Postgres connection — a small but real wrinkle in a PgBouncer-fronted
  deployment (one extra connection per replica; must not be transaction-pooled). Documented above.
- NOTIFY payload + 63-byte channel-name limits force the hash-channel + payload-routing scheme. Encapsulated
  inside the impl; callers are unaffected.
- At-most-once delivery means a NOTIFY lost during a DB failover is only recovered by the
  reconnect-rebroadcast + the 15s client fallback poll — acceptable given idempotent, data-free signals,
  but worth a load test before we lean on it (#21/#31).

---

## Follow-ups

| Item | Issue |
|------|-------|
| Implement `PgListenNotifyRealtimeService` (direct conn, hash-channel, payload routing) | #21 |
| Multi-replica fan-out load/soak test (failover, reconnect-rebroadcast correctness) | #31 |
| Confirm deployment PgBouncer pool mode + a dedicated direct-connection path for the listener | #31 |

---

*Document authored 2026-06-25 by Basher (Realtime Engineer). Decision O3: the in-process broker is the
shipped MVP; LISTEN/NOTIFY behind `RealtimeService` is the approved production direction (impl tracked by #21).*
