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

// TODO(real provider): A concrete Apple Music or Spotify implementation must supply:
//   - Server-side developer tokens (Apple: signed MusicKit JWT; Spotify: client_credentials).
//     Tokens must NEVER be exposed to the client — all catalog calls go through this backend.
//   - User OAuth tokens where personalized access is needed (Apple Music: MusicKit user token;
//     Spotify: Authorization Code + PKCE). Token refresh must be handled server-side.
//   - Rate-limit awareness: Apple Music ~3,000 req/min; Spotify varies (~10–30 req/s per endpoint).
//     Cache catalog search results (e.g., Redis with short TTL) to avoid burning the quota.
//   - A `resolve(providerId: string): Promise<Track>` method for queue hydration — when a stored
//     provider ID needs to be re-fetched (e.g., artwork URL expiry).
//   - Graceful degradation: if the provider is down, callers should degrade gracefully rather than
//     surface a 5xx. The stub remains valid as a fallback for local/demo environments.
