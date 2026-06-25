# 2026-06-24 — iTunes top tracks dev seed

**By:** Livingston

## What
At dev seed time, fetch the iTunes US Top Songs RSS (limit 100), batch lookup the returned track IDs through iTunes `/lookup`, normalize through the existing iTunes Track model, and upsert the results as `provider='itunes'`. If real rows are available, repoint the seeded demo queue item IDs to those iTunes rows so the guest cover-flow carousel shows real artwork. The step is skipped in `NODE_ENV=test`, can be disabled with `SEED_ITUNES=false`, and any provider failure logs a warning and leaves the stub catalog/queue intact.

## Why
Option B best matches the owner goal: real cover art in the carousel, not only in search. It remains safe because the existing stub tracks, stable UUIDs, queue item IDs, statuses, and positions are preserved; only the queue `track_id` is swapped after successful iTunes cache upsert, and never during unit tests. iTunes is the MVP provider per the prior Livingston decision because it needs no credentials and satisfies the normalized Track model without holding the product hostage to Spotify Premium or any provider outage.

## References
#9, A1, O6, D10; constraints: 122/122 tests green, network-failure-safe seed, idempotent `(provider, providerId)` upsert, bounded/opt-out dev fetch, provider calls server-side only.
