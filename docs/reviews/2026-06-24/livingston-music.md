# Livingston music integration audit — 2026-06-24

## Overall health

The music integration is in decent MVP shape: the live iTunes provider normalizes catalog data into a small provider-agnostic `Track`, server-side credentials are not exposed, Spotify/Apple are clearly documented as deferred scaffolds, and the seed path degrades defensively to stub data. The biggest risks are resilience and abstraction seams: live provider HTTP has no request timeout and can honor unbounded `Retry-After` sleeps inside request handlers, the routed `resolve(providerId)` path is not actually provider-aware, and search always calls the upstream provider despite being described as cache-protecting repeated searches.

## Findings

| SEV | Title | file:line | Problem | Fix |
| --- | --- | --- | --- | --- |
| High | Provider calls can hang request handlers indefinitely | `api/src/music/itunes.ts:89`, `api/src/music/itunes.ts:109`, `api/src/music/http.ts:48`, `api/src/music/index.ts:48` | `/api/tracks/search` awaits iTunes through `fetchWithBackoff`, but the live provider passes no `AbortSignal`/timeout. If the provider TCP/TLS/request stalls, routing fallback never gets a chance and the Express handler can sit open indefinitely. The dev seed has a 5s abort wrapper, but production search/resolve does not. | Add a provider HTTP timeout budget in `fetchWithBackoff` or `ITunesMusicProvider` using `AbortController`, and treat timeout as retryable so `RoutingMusicProvider` can fall back to stub within a bounded SLA. |
| Medium | `Retry-After` can bypass the configured backoff cap | `api/src/music/http.ts:61` | `fetchWithBackoff` caps exponential waits with `maxDelayMs`, but `await sleep(retryAfter ?? backoff)` uses provider-supplied `Retry-After` without any cap. A 429/503 with a large `Retry-After` can park a guest search request for minutes/hours. | Clamp `Retry-After` to `maxDelayMs` (or a separate absolute cap) and consider failing over to the next provider when the retry delay exceeds the request budget. |
| Medium | Routed resolve is not provider-aware | `api/src/music/provider.ts:38`, `api/src/music/router.ts:22`, `api/src/music/stub.ts:16` | `MusicProvider.resolve` accepts only `providerId`; `RoutingMusicProvider` retries that same id against fallback providers, and `StubMusicProvider.resolve` searches by `providerId` without `provider='stub'`. If providers share ids, fallback can return the wrong track, and future multi-provider lookup cannot cleanly resolve `(provider, providerId)`. | Change the interface/route seam to resolve by `(provider, providerId)` or by internal `tracks.id`; make stub resolve include its provider predicate; do not fall back across providers for an id from a different namespace unless explicitly mapped. |
| Medium | Search is not actually cache-protected | `api/src/music/itunes.ts:78`, `api/src/music/itunes.ts:89`, `api/src/music/cache.ts:1` | Search results are upserted after every provider response, but repeated popular queries still call iTunes every time. This contradicts the cache comment/README claim that repeated searches avoid provider rate limits and leaves the endpoint exposed to upstream quota pressure even with guest rate limits. | Add a short-lived query cache keyed by normalized `(provider, storefront, query, limit)` or serve recent matching `tracks` rows before hitting the provider; include stampede protection for identical in-flight searches. |
| Low | Demo queue repointing keeps provider cache rows undeletable | `api/src/db/seed-itunes.ts:86`, `api/src/db/schema.ts:130`, `api/drizzle/0000_baseline_slice01_02.sql:129` | `seedITunesTopTracksForDev` repoints seeded queue items to iTunes cache rows, while `queue_items.track_id` references `tracks.id` with no delete action. Those cache rows become durable queue dependencies, so any future cache-prune/delete job will fail or need to special-case queued tracks. | Treat queued tracks as immutable snapshots separate from provider cache rows, or make cache pruning skip referenced rows; document/enforce this before adding cache eviction. |
| Low | No music resolve/lookup HTTP route is registered | `api/src/http/routes.ts:113` | Routes expose only `GET /api/tracks/search`; the provider/cache layer has `resolve`, but there is no music-facing lookup endpoint to rehydrate a provider id or force TTL refresh outside internal code. This makes the public seam less complete for provider swaps and preview refresh workflows. | Add a bounded, provider-aware resolve/lookup route when clients need metadata refresh, or remove it from the expected external contract and keep it strictly internal. |

## What's solid

- The normalized server `Track` is mostly provider-agnostic: provider-native details are reduced to `provider` + `providerId`, with title/artist/album/art/duration/preview fields.
- iTunes search/lookup use `URLSearchParams`, include `entity=song`/`country`, filter to songs, preserve duration in milliseconds, and tolerate missing optional fields.
- `tracks` has the right uniqueness key for provider cache rows: `(provider, provider_id)`.
- `upsertTrack` is idempotent and preserves the internal UUID, so existing queue references survive metadata refresh.
- The dev seed path is defensive: `SEED_ITUNES` can disable it, network failures are caught, and startup continues with stub catalog data.
- Spotify and Apple Music secrets stay server-side and the deferred providers fail fast instead of silently half-working.

## Verification

Static review only per request. I read the music provider/cache/router/http/seed/schema/route code, queue/web touchpoints, music tests, README, and env docs. I did not modify application code and did not push.
