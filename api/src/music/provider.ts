// Owner: Livingston (real implementations) | Rusty (interface)
// MusicProvider abstraction — swap stub for Apple Music / Spotify without touching callers.

export interface Track {
  id:         string;
  provider:   string;
  providerId: string;
  title:      string;
  artist:     string;
  album:      string;
  artworkUrl: string;
  durationMs: number;
}

export interface MusicProvider {
  /**
   * Search tracks by query string.
   * Empty query returns a default/featured list.
   */
  search(query: string, limit?: number): Promise<Track[]>;
}
