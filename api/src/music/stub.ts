// Owner: Livingston (refine stub, add real providers)
// StubMusicProvider: reads seeded tracks from DB, filters by query.
// Replace with real Apple Music / Spotify implementation when tokens are available.
import { pool } from '../db/pool.js';
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

export class StubMusicProvider implements MusicProvider {
  async search(query: string, limit = 15): Promise<Track[]> {
    if (!query.trim()) {
      // Empty query → return all seeded tracks (default list)
      const result = await pool.query(
        `SELECT id, provider, provider_id, title, artist, album, artwork_url, duration_ms
         FROM tracks WHERE provider = 'stub' ORDER BY title ASC LIMIT $1`,
        [limit],
      );
      return result.rows.map(rowToTrack);
    }

    // Server-side search: case-insensitive substring on title, artist, album
    const q = `%${query.toLowerCase()}%`;
    const result = await pool.query(
      `SELECT id, provider, provider_id, title, artist, album, artwork_url, duration_ms
       FROM tracks
       WHERE provider = 'stub'
         AND (lower(title) LIKE $1 OR lower(artist) LIKE $1 OR lower(album) LIKE $1)
       ORDER BY title ASC
       LIMIT $2`,
      [q, limit],
    );
    return result.rows.map(rowToTrack);
  }
}
