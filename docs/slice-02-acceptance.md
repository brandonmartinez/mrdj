# Slice-02 Acceptance — DJ Console + SSE Realtime

> Extends `docs/slice-01-acceptance.md` (S-01..S-13, MC-01..MC-10 still apply via regression).
> New gates below. Verified by the extended smoke (`session files/smoke.py`) + `npm test -w api`.

## Realtime (SSE)
- **R-01** `GET /api/events/demo/stream` responds `200 text/event-stream` and emits an initial
  `hello` event.
- **R-02** After a queue mutation (e.g. a request add) a `queue` event is delivered to an open
  stream within ~1s.
- **R-03** Guest + console UIs update from the SSE signal (re-fetch), not only the fallback poll.

## DJ Console
- **C-01** Admin sees a "DJ Console" toggle (header); guests never see admin controls.
- **C-02** Console lists now-playing, upcoming (ordered), played, with the Play Next holder marked.
- **C-03** Reorder ↑/↓ moves a pending item and the new order is reflected for all clients.
- **C-04** Remove takes an item out of the queue for all clients.
- **C-05** Skip (advance) promotes the next song; Cover Flow + console both move.
- **C-06** Stats panel shows request count, credits spent, refunds, Play Next purchases.

## Admin RBAC (MC-extends)
- **AR-01** Guest → `POST /admin/events/demo/reorder` = 403 forbidden.
- **AR-02** Guest → `POST /admin/events/demo/remove` = 403 forbidden.
- **AR-03** Guest → `GET /admin/events/demo/stats` = 403 forbidden.

## O7 auto-refund (money-correctness)
- **MR-01** Admin removes a **pending boosted** item → requester refunded exactly the boost cost;
  an append-only `type='refund'` row exists; wallet balance increases by that amount.
- **MR-02** Admin removes a **pending Play Next** item → requester refunded the Play Next price
  AND the slot resets to `available`.
- **MR-03** Removing a **free (queue-tier)** item → no refund row, balance unchanged.
- **MR-04** Double-remove / replayed remove → refund applied **once** (idempotent `refund-<id>`).
- **MR-05** Normal **advance/skip** of the now-playing item → **no** refund (D6 unchanged).
- **MR-06** A removed item that had already **played** → no refund.

## Hardening
- **H-01** Concurrent spend that trips the wallet CHECK returns **402** (code
  `insufficient_credits`), never 500. Balance never goes negative.
- **H-02** A handler that throws returns a JSON `500 { error: { code: "internal" } }`; the API
  process stays up (no crash) — verified by a follow-up `/api/health` = 200.

## Regression
- **REG-01** slice-01 smoke (46 assertions) stays green.
- **REG-02** `npm test -w api` money + gate suites stay green.
