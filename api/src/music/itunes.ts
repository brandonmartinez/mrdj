// Owner: Livingston (real MVP provider — #22 search/resolve/cache)
// iTunes Search API: Apple's public catalog. Free, no credentials, returns
// title/artist/album/artwork/30s preview/duration — everything Track needs.
// Endpoints:
//   GET /search?term=&entity=song&limit=&country=   → catalog search
//   GET /lookup?id=                                  → resolve a single track
// Results are normalized and cached in `tracks` (provider='itunes') so queue
// requests resolve by internal UUID and repeat lookups skip the network.
import { cfg } from '../config/index.js';
import { fetchWithBackoff, type BackoffOptions } from './http.js';
import {
  upsertTracks, resolveWithCache, type NormalizedTrack,
} from './cache.js';
import type { MusicProvider, Track } from './provider.js';

export const ITUNES_PROVIDER = 'itunes';

/** Subset of the iTunes Search result object we consume. */
export interface ITunesResult {
  wrapperType?: string;
  kind?:        string;
  trackId?:     number;
  trackName?:   string;
  artistName?:  string;
  collectionName?: string;
  artworkUrl100?:  string;
  previewUrl?:     string;
  trackTimeMillis?: number;
}

interface ITunesResponse {
  resultCount: number;
  results: ITunesResult[];
}

/** Upgrade the 100x100 artwork URL iTunes returns to a larger square. */
export function upscaleArtwork(url: string | undefined, size = 300): string {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function isSong(r: ITunesResult): boolean {
  // /search returns wrapperType 'track' + kind 'song'; /lookup mirrors this.
  return (r.kind ?? '') === 'song' && typeof r.trackId === 'number' && !!r.trackName;
}

export function normalize(r: ITunesResult): NormalizedTrack {
  return {
    provider:   ITUNES_PROVIDER,
    providerId: String(r.trackId),
    title:      r.trackName ?? '',
    artist:     r.artistName ?? '',
    album:      r.collectionName ?? '',
    artworkUrl: upscaleArtwork(r.artworkUrl100),
    durationMs: r.trackTimeMillis ?? 0,
    previewUrl: r.previewUrl ?? null,
  };
}

export interface ITunesProviderOptions {
  baseUrl?:    string;
  storefront?: string;
  backoff?:    BackoffOptions;
}

function defaultBackoff(): BackoffOptions {
  return {
    maxAttempts:       cfg.itunesMaxAttempts,
    baseDelayMs:       cfg.itunesBaseDelayMs,
    maxDelayMs:        cfg.itunesMaxDelayMs,
    retryAfterMaxMs:   cfg.itunesRetryAfterMaxMs,
    maxTotalBackoffMs: cfg.itunesMaxTotalBackoffMs,
    attemptTimeoutMs:  cfg.itunesRequestTimeoutMs,
    totalTimeoutMs:    cfg.itunesTotalTimeoutMs,
  };
}

export class ITunesMusicProvider implements MusicProvider {
  readonly name = ITUNES_PROVIDER;
  private readonly baseUrl: string;
  private readonly storefront: string;
  private readonly backoff?: BackoffOptions;

  constructor(opts: ITunesProviderOptions = {}) {
    this.baseUrl    = (opts.baseUrl ?? cfg.itunesBaseUrl).replace(/\/$/, '');
    this.storefront = opts.storefront ?? cfg.itunesStorefront;
    this.backoff    = { ...defaultBackoff(), ...opts.backoff };
  }

  async search(query: string, limit = 15): Promise<Track[]> {
    const term = query.trim();
    // iTunes Search has no "featured/empty" mode; use a sensible default seed term.
    const effective = term || 'top songs';
    const url = `${this.baseUrl}/search?` + new URLSearchParams({
      term:    effective,
      entity:  'song',
      limit:   String(limit),
      country: this.storefront,
    }).toString();

    const res = await fetchWithBackoff(url, { headers: { Accept: 'application/json' } }, this.backoff);
    if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
    const data = (await res.json()) as ITunesResponse;

    const normalized = (data.results ?? []).filter(isSong).map(normalize);
    // Cache (upsert) and return rows with internal ids so the queue can request them.
    return upsertTracks(normalized);
  }

  async resolve(providerId: string): Promise<Track | null> {
    return resolveWithCache(ITUNES_PROVIDER, providerId, (id) => this.fetchById(id));
  }

  /** Raw provider fetch by id (used by the cache layer on miss/stale). */
  private async fetchById(providerId: string): Promise<NormalizedTrack | null> {
    const url = `${this.baseUrl}/lookup?` + new URLSearchParams({
      id:      providerId,
      country: this.storefront,
    }).toString();

    const res = await fetchWithBackoff(url, { headers: { Accept: 'application/json' } }, this.backoff);
    if (!res.ok) throw new Error(`iTunes lookup failed (${res.status})`);
    const data = (await res.json()) as ITunesResponse;
    const hit = (data.results ?? []).find(isSong);
    return hit ? normalize(hit) : null;
  }
}
