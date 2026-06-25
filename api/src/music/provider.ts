// Owner: Livingston (real implementations) | Rusty (interface)
// MusicProvider abstraction — swap providers without touching callers (A1).
//
// MVP provider is iTunes Search (Apple's public catalog: free, no credentials).
// Spotify and Apple Music (MusicKit) are interface-ready scaffolds — see
// spotify.ts / apple.ts. Per D10/O6: Spotify's Web API now requires a Premium
// account, so the MVP ships on iTunes Search; Spotify/Apple Music are wired in
// later via the same seam with no caller changes.

export interface Track {
  id:         string;
  provider:   string;
  /** Provider-native track id; unique only with `provider` (cache key: provider + providerId). */
  providerId: string;
  title:      string;
  artist:     string;
  album:      string;
  artworkUrl: string;
  durationMs: number;
  /** 30-second preview clip URL, if the provider supplies one. May expire (see cache TTL, #27). */
  previewUrl: string | null;
}

export interface MusicProvider {
  /** Stable provider key, stored on each Track row (e.g. 'itunes', 'spotify', 'apple'). */
  readonly name: string;

  /**
   * Search tracks by query string.
   * Empty query returns a default/featured list.
   * Results are normalized to Track and cached in the `tracks` table.
   * The optional signal aborts caller-initiated work without writing partial cache rows.
   */
  search(query: string, limit?: number, signal?: AbortSignal): Promise<Track[]>;

  /**
   * Re-fetch a single track by its provider-native ID (queue hydration / stale
   * preview re-resolution, #27). Returns null if the provider no longer has it.
   * providerId is interpreted within this provider's namespace, never globally.
   */
  resolve(providerId: string, signal?: AbortSignal): Promise<Track | null>;
}

/** Thrown when a provider can't be constructed because required env is missing (fail-fast). */
export class MusicProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicProviderConfigError';
  }
}
