// Owner: Livingston (track cache — #22 DB cache, #27 TTL + stale re-resolution)
// Normalizes provider results into the `tracks` table so:
//   1. Queue requests resolve a stable internal UUID (queue/index.ts looks up by tracks.id).
//   2. Repeated searches avoid burning provider rate limits.
//   3. Expiring preview URLs are refreshed via TTL-based re-resolution (#27).
import { and, eq, asc, ilike, or } from 'drizzle-orm';
import { db, tracks } from '../db/index.js';
import { cfg } from '../config/index.js';
import type { Track } from './provider.js';

const TRACK_COLS = {
  id:          tracks.id,
  provider:    tracks.provider,
  providerId:  tracks.providerId,
  title:       tracks.title,
  artist:      tracks.artist,
  album:       tracks.album,
  artworkUrl:  tracks.artworkUrl,
  durationMs:  tracks.durationMs,
  previewUrl:  tracks.previewUrl,
  cachedAt:    tracks.cachedAt,
};

type Row = Record<string, unknown>;

function rowToTrack(r: Row): Track {
  return {
    id:         r.id as string,
    provider:   r.provider as string,
    providerId: r.providerId as string,
    title:      r.title as string,
    artist:     r.artist as string,
    album:      r.album as string,
    artworkUrl: (r.artworkUrl as string) ?? '',
    durationMs: (r.durationMs as number) ?? 0,
    previewUrl: (r.previewUrl as string | null) ?? null,
  };
}

/** A normalized provider result, minus the internal id which the cache assigns. */
export type NormalizedTrack = Omit<Track, 'id'>;

/**
 * Upsert a provider result into `tracks` keyed by (provider, providerId), refreshing
 * mutable fields and `cachedAt`. Returns the row as a Track (with internal id).
 */
export async function upsertTrack(t: NormalizedTrack): Promise<Track> {
  const now = new Date();
  const [row] = await db
    .insert(tracks)
    .values({
      provider:   t.provider,
      providerId: t.providerId,
      title:      t.title,
      artist:     t.artist,
      album:      t.album,
      artworkUrl: t.artworkUrl,
      durationMs: t.durationMs,
      previewUrl: t.previewUrl,
      cachedAt:   now,
    })
    .onConflictDoUpdate({
      target: [tracks.provider, tracks.providerId],
      set: {
        title:      t.title,
        artist:     t.artist,
        album:      t.album,
        artworkUrl: t.artworkUrl,
        durationMs: t.durationMs,
        previewUrl: t.previewUrl,
        cachedAt:   now,
      },
    })
    .returning(TRACK_COLS);
  return rowToTrack(row);
}

/** Upsert many provider results, preserving order. */
export async function upsertTracks(items: NormalizedTrack[]): Promise<Track[]> {
  const out: Track[] = [];
  for (const t of items) out.push(await upsertTrack(t));
  return out;
}

/** Look up a cached track by provider-native id. */
export async function findCachedByProviderId(
  provider: string,
  providerId: string,
): Promise<{ track: Track; cachedAt: Date } | null> {
  const [row] = await db
    .select(TRACK_COLS)
    .from(tracks)
    .where(and(eq(tracks.provider, provider), eq(tracks.providerId, providerId)));
  if (!row) return null;
  return { track: rowToTrack(row), cachedAt: row.cachedAt as Date };
}

/** True when a cache entry is older than the configured TTL (#27). */
export function isStale(cachedAt: Date, ttlMs = cfg.trackCacheTtlMs): boolean {
  return Date.now() - cachedAt.getTime() > ttlMs;
}

/**
 * Resolve a track by provider id with TTL-aware caching (#27):
 *   - Fresh cache hit → return cached row (no provider call).
 *   - Miss or stale    → call `fetchFresh`, re-upsert (refreshing preview_url + cachedAt), return it.
 *     Existing queue references survive because the row id is preserved by the upsert.
 *   - Stale but provider returns null → fall back to the stale cached row rather than failing.
 */
export async function resolveWithCache(
  provider: string,
  providerId: string,
  fetchFresh: (providerId: string) => Promise<NormalizedTrack | null>,
  ttlMs = cfg.trackCacheTtlMs,
): Promise<Track | null> {
  const cached = await findCachedByProviderId(provider, providerId);
  if (cached && !isStale(cached.cachedAt, ttlMs)) return cached.track;

  const fresh = await fetchFresh(providerId);
  if (fresh) return upsertTrack(fresh);

  // Provider no longer has it (or errored) — serve the stale copy if we have one.
  return cached?.track ?? null;
}

/** Read seeded/local stub tracks straight from the DB (no provider). */
export async function searchStubTracks(query: string, limit = 15): Promise<Track[]> {
  const base = eq(tracks.provider, 'stub');
  if (!query.trim()) {
    const rows = await db.select(TRACK_COLS).from(tracks)
      .where(base).orderBy(asc(tracks.title)).limit(limit);
    return rows.map(rowToTrack);
  }
  const q = `%${query.toLowerCase()}%`;
  const rows = await db.select(TRACK_COLS).from(tracks)
    .where(and(base, or(ilike(tracks.title, q), ilike(tracks.artist, q), ilike(tracks.album, q))))
    .orderBy(asc(tracks.title)).limit(limit);
  return rows.map(rowToTrack);
}

export { rowToTrack, TRACK_COLS };
