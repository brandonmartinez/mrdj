# Music providers (Epic 5, #9)

The music layer turns a search query into normalized `Track` rows behind the
provider-agnostic `MusicProvider` interface (`provider.ts`, anchor A1). Callers
(`/api/tracks/search`, queue requests) never depend on which provider answered.

## Active provider

Set `MUSIC_PROVIDER` (default `itunes`):

| Value     | Status   | Credentials | Notes |
|-----------|----------|-------------|-------|
| `itunes`  | **live** | none        | Apple's public iTunes Search API. MVP default. |
| `spotify` | scaffold | `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Web API now requires a **Premium** account; token manager is real, search/resolve are stubbed. |
| `apple`   | scaffold | `APPLE_MUSIC_TEAM_ID` / `APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_PRIVATE_KEY` | MusicKit dev-token builder is real (ES256 JWT); search/resolve are stubbed. Documented fast-follow. |
| `stub`    | dev/test | none        | Serves only seeded local tracks. |

> Why iTunes for the MVP: Spotify's Web API moved behind Spotify Premium
> (their docs, 2026-06), so a free account can't use it. iTunes Search is free,
> keyless, and returns title/artist/album/artwork/30s preview/duration — exactly
> what `Track` needs. See `.squad/decisions.md` (D10/O6) for the full rationale.

The active provider is wrapped in a `RoutingMusicProvider` with the seeded stub
as a fallback tier, so a provider outage degrades to local results instead of a
5xx (#24).

## Caching & TTL (#22, #27)

Search/resolve results are upserted into the `tracks` table keyed by
`(provider, provider_id)`. The internal `tracks.id` UUID is stable across
re-resolution, so queue references survive. Reads check `cached_at` against
`TRACK_CACHE_TTL_MS`; stale entries trigger a provider re-fetch that refreshes
`preview_url` + `cached_at` in place (`cache.ts`).

## Rate limiting (#22)

All provider HTTP goes through `fetchWithBackoff` (`http.ts`): exponential
backoff on `429`/`503`, honoring `Retry-After`.

## Integration tests / VCR fixtures (#29)

`src/__tests__/music.test.ts` replays recorded HTTP fixtures via
[`nock`](https://github.com/nock/nock) — no network in CI (`nock.disableNetConnect()`).
Fixtures live in `src/__tests__/fixtures/music/`.

### Re-recording fixtures

When a provider contract changes, re-capture the raw responses:

```bash
# iTunes search
curl -s "https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=3&country=US" \
  -o api/src/__tests__/fixtures/music/itunes-search-daftpunk.json

# iTunes lookup (resolve) — id is an iTunes trackId from the search result
curl -s "https://itunes.apple.com/lookup?id=697195462&country=US" \
  -o api/src/__tests__/fixtures/music/itunes-lookup-onemoretime.json
```

Then run `npm test -w api` to confirm the replay still matches the code's
normalization. Keep fixtures small (a few results) and free of personal data.
