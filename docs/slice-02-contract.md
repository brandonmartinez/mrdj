# Slice-02 API Contract — DJ Console + SSE Realtime

> Frozen by Rusty on 2026-06-24. Extends `docs/slice-01-contract.md` (still in force).
> Implements O3 (=SSE) and O7 part-1 (=auto-refund). No DB migration: the slice-01 schema
> already has `credit_transactions.type='refund'` and `queue_items.status='rejected'`.

---

## 1. Realtime — SSE (resolves O3)

### `GET /api/events/:slug/stream`  *(open — same audience as the queue GET)*
Server-Sent Events stream. **Invalidation-signal pattern:** the server never ships per-user
data (balances) over the stream — it emits a lightweight "something changed" signal and the
client re-fetches `GET /api/events/:slug/queue` (which is per-user and already correct).

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

Events:
```
event: hello
data: {"eventId":"<uuid>","at":"<iso>"}

event: queue
data: {"type":"queue:changed","eventId":"<uuid>","at":"<iso>"}

: heartbeat            ← comment line every ~25s to keep the connection alive
```
- A `queue` event is published after **every** queue/money mutation: request add, advance/skip,
  reorder, remove/reject, admin grant.
- Client uses `EventSource`; on `queue` → re-fetch the queue view. `EventSource` auto-reconnects;
  client also keeps a low-frequency fallback poll (~15s) for resilience.

**Broker:** in-process `EventEmitter` (single process — the local/MVP deliverable). Seam allows a
Postgres `LISTEN/NOTIFY` broker for multi-replica prod later — note: PgBouncer transaction pooling
cannot `LISTEN/NOTIFY`, so the prod listener needs a **direct** Postgres connection. Not built now.

---

## 2. Admin endpoints (all `requireAdmin` — guest → 403)

### `POST /api/admin/events/:slug/reorder`
Body: `{ "queueItemId": "uuid", "direction": "up" | "down" }`
Swaps a **pending** item with its neighbor in the requested direction. The Play Next holder is
pinned at the top and is immovable; non-holder items cannot move above it.
Response: `{ "queueView": QueueView }`
Errors: `400 validation` (bad id/direction, item not pending, or move blocked by Play Next pin),
`404 not_found` (event/item).

### `POST /api/admin/events/:slug/remove`
Body: `{ "queueItemId": "uuid" }`
Removes/rejects a **pending** item (`status='rejected'`, positions of remaining pending items
recompacted). **O7 auto-refund:** if the item had a paid spend (boost/play_next) and had not
played, the requester is refunded the exact credits (idempotent). If it was the Play Next holder,
the slot resets to `available`.
Response: `{ "queueView": QueueView, "refund": { "userId": "uuid", "amount": number } | null }`
Errors: `400 validation` (item not pending), `404 not_found`.

### `GET /api/admin/events/:slug/stats`
Response (the stats object is nested under a `stats` key):
```json
{
  "stats": {
    "requestCount":     12,
    "paidRequestCount": 5,
    "creditsSpent":     14,
    "creditsRefunded":  3,
    "playNext":  { "status": "locked", "purchasedCount": 2 },
    "topRequesters": [ { "userId": "uuid", "displayName": "Guest User", "requests": 4, "spent": 6 } ]
  }
}
```

### (reused) `POST /api/admin/events/:slug/advance`  — "Skip / Play next song" in the console.
### (reused) `POST /api/admin/credits/grant` — grant credits from the console.

---

## 3. Hardening (slice-01 deferrals)

- **402 not 500 under concurrent spend:** `createRequestHandler` catches Postgres `23514`
  (wallets `balance >= 0` CHECK violation) and returns
  `402 { error: { code: "insufficient_credits", required, balance } }`.
- **Async error boundary:** all async route handlers are wrapped (`asyncHandler`) so a thrown/
  rejected error routes to a terminal Express error-middleware returning
  `500 { error: { code: "internal", message: "Internal server error" } }`. Process-level
  `unhandledRejection`/`uncaughtException` handlers **log and keep serving** (no hard exit) so a
  transient DB error can't crash the API. New error code: `internal`.

---

## 4. New error code
`ApiError.code` adds `"internal"` (500) to the slice-01 set
(`insufficient_credits | play_next_unavailable | forbidden | not_found | validation`).

---

## 5. Module ownership (delta)
| Module | Owner | Status |
|--------|-------|--------|
| `realtime/` (SSE broker + handler) | Basher | 🆕 this slice |
| `credits/service.ts` `refundCredits` | Frank/Basher | 🆕 this slice |
| `queue/` reorder/remove cores + publish hooks | Basher | 🆕 this slice |
| `admin/` reorder/remove/stats | Basher | 🆕 this slice |
| `http/` asyncHandler + error middleware | Rusty | 🆕 this slice |
| web `AdminConsole` + SSE client hook | Linus | 🆕 this slice |
