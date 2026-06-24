// Owner: Livingston (refine stub, add real providers)
// StubMusicProvider: reads seeded tracks from DB, filters by query.
// Replace with real Apple Music / Spotify implementation when tokens are available.
import { and, eq, or, ilike, asc } from 'drizzle-orm';
import { db, tracks } from '../db/index.js';
import type { MusicProvider, Track } from './provider.js';

function rowToTrack(r: Record<string, unknown>): Track {
  return {
    id:         r.id as string,
    provider:   r.provider as string,
    providerId: r.provider_id as string,
    title:      r.title as string,
    artist:     r.artist as string,
    album:      r.album as string,
    artworkUrl: r.artwork_url as string,
    durationMs: r.duration_ms as number,
  };
}

const TRACK_COLS = {
  id:          tracks.id,
  provider:    tracks.provider,
  provider_id: tracks.providerId,
  title:       tracks.title,
  artist:      tracks.artist,
  album:       tracks.album,
  artwork_url: tracks.artworkUrl,
  duration_ms: tracks.durationMs,
};

export class StubMusicProvider implements MusicProvider {
  async search(query: string, limit = 15): Promise<Track[]> {
    if (!query.trim()) {
      // Empty query → return all seeded tracks (default list)
      const rows = await db
        .select(TRACK_COLS)
        .from(tracks)
        .where(eq(tracks.provider, 'stub'))
        .orderBy(asc(tracks.title))
        .limit(limit);
      return rows.map(rowToTrack);
    }

    // Server-side search: case-insensitive substring on title, artist, album
    const q = `%${query.toLowerCase()}%`;
    const rows = await db
      .select(TRACK_COLS)
      .from(tracks)
      .where(
        and(
          eq(tracks.provider, 'stub'),
          or(ilike(tracks.title, q), ilike(tracks.artist, q), ilike(tracks.album, q)),
        ),
      )
      .orderBy(asc(tracks.title))
      .limit(limit);
    return rows.map(rowToTrack);
  }
}
