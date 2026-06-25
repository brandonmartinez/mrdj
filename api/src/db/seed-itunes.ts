// Owner: Livingston (dev seed real catalog art — iTunes, never product-critical)
import { and, eq, inArray } from 'drizzle-orm';
import { cfg } from '../config/index.js';
import { fetchWithBackoff } from '../music/http.js';
import { normalize, type ITunesResult } from '../music/itunes.js';
import { upsertTracks } from '../music/cache.js';
import type { Track } from '../music/provider.js';
import { db, queueItems, tracks } from './index.js';

const DEFAULT_LIMIT = 100;
const LOOKUP_CHUNK_SIZE = 25;
const FETCH_TIMEOUT_MS = 5_000;

interface TopSongsFeed {
  feed?: {
    entry?: Array<{
      id?: { attributes?: { 'im:id'?: string } };
    }>;
  };
}

interface ITunesLookupResponse {
  results?: ITunesResult[];
}

export interface SeedITunesTopTracksOptions {
  queueItemIds?: string[];
  limit?: number;
}

function shouldSeedITunes(): boolean {
  if ((process.env.NODE_ENV ?? 'development') === 'test') return false;
  const flag = (process.env.SEED_ITUNES ?? 'true').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(flag);
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchWithBackoff(
      url,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
      { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 2_000 },
    );
    if (!res.ok) throw new Error(`iTunes seed fetch failed (${res.status})`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isSong(r: ITunesResult): boolean {
  return (r.kind ?? '') === 'song' && typeof r.trackId === 'number' && !!r.trackName;
}

async function fetchTopSongIds(limit: number): Promise<string[]> {
  const storefront = cfg.itunesStorefront.toLowerCase();
  const url = `${cfg.itunesBaseUrl.replace(/\/$/, '')}/${storefront}/rss/topsongs/limit=${limit}/json`;
  const data = await fetchJson<TopSongsFeed>(url);
  return (data.feed?.entry ?? [])
    .map((entry) => entry.id?.attributes?.['im:id'])
    .filter((id): id is string => !!id);
}

async function lookupTracks(ids: string[]): Promise<ITunesResult[]> {
  const baseUrl = cfg.itunesBaseUrl.replace(/\/$/, '');
  const out: ITunesResult[] = [];
  for (const group of chunks(ids, LOOKUP_CHUNK_SIZE)) {
    const url = `${baseUrl}/lookup?` + new URLSearchParams({
      id: group.join(','),
      country: cfg.itunesStorefront,
      entity: 'song',
    }).toString();
    const data = await fetchJson<ITunesLookupResponse>(url);
    out.push(...(data.results ?? []).filter(isSong));
  }
  return out;
}

async function repointStubQueueToItunes(queueItemIds: string[], seededTracks: Track[]): Promise<number> {
  if (queueItemIds.length === 0 || seededTracks.length === 0) return 0;

  const current = await db
    .select({ id: queueItems.id, provider: tracks.provider })
    .from(queueItems)
    .innerJoin(tracks, eq(queueItems.trackId, tracks.id))
    .where(inArray(queueItems.id, queueItemIds));

  const stubIds = new Set(current.filter((row) => row.provider === 'stub').map((row) => row.id));
  let updated = 0;
  for (const [index, queueItemId] of queueItemIds.entries()) {
    const track = seededTracks[index];
    if (!track || !stubIds.has(queueItemId)) continue;
    const rows = await db
      .update(queueItems)
      .set({ trackId: track.id })
      .where(and(eq(queueItems.id, queueItemId), inArray(queueItems.id, [...stubIds])))
      .returning({ id: queueItems.id });
    updated += rows.length;
  }
  return updated;
}

export async function seedITunesTopTracksForDev(opts: SeedITunesTopTracksOptions = {}): Promise<void> {
  if (!shouldSeedITunes()) {
    console.log('[seed] iTunes top tracks skipped (NODE_ENV=test or SEED_ITUNES disabled)');
    return;
  }

  try {
    const ids = await fetchTopSongIds(opts.limit ?? DEFAULT_LIMIT);
    if (ids.length === 0) throw new Error('iTunes RSS returned no track IDs');

    const lookupResults = await lookupTracks(ids);
    const seededTracks = await upsertTracks(lookupResults.map(normalize));
    const queueUpdated = await repointStubQueueToItunes(opts.queueItemIds ?? [], seededTracks);

    console.log(`[seed] ✓ iTunes top tracks cached: ${seededTracks.length}; demo queue real-art items: ${queueUpdated}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[seed] ⚠ iTunes top tracks unavailable; continuing with stub catalog (${msg})`);
  }
}
