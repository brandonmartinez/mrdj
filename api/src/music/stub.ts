// Owner: Livingston (refine stub, add real providers)
// StubMusicProvider: reads seeded tracks from the DB (provider='stub'), filters by
// query. Remains the dev/test fallback and the default when MUSIC_PROVIDER=stub.
import { eq } from 'drizzle-orm';
import { db, tracks } from '../db/index.js';
import { searchStubTracks, rowToTrack, TRACK_COLS } from './cache.js';
import type { MusicProvider, Track } from './provider.js';

export class StubMusicProvider implements MusicProvider {
  readonly name = 'stub';

  async search(query: string, limit = 15, _signal?: AbortSignal): Promise<Track[]> {
    return searchStubTracks(query, limit);
  }

  async resolve(providerId: string, _signal?: AbortSignal): Promise<Track | null> {
    const [row] = await db
      .select(TRACK_COLS)
      .from(tracks)
      .where(eq(tracks.providerId, providerId));
    return row ? rowToTrack(row) : null;
  }
}
