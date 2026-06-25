// Owner: Livingston (Spotify scaffold — #19 token, #22 search/resolve)
// INTERFACE-READY SCAFFOLD, NOT WIRED. Spotify's Web API now requires a Premium
// account (per their docs, 2026-06), so the Epic 5 MVP ships on iTunes Search.
// This file keeps the seam ready: when a Premium app is available, set
// MUSIC_PROVIDER=spotify and supply SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.
//
// The client-credentials token manager below is real and works; the search/resolve
// methods are intentionally stubbed (throw) so nothing silently half-works in prod.
import { cfg } from '../config/index.js';
import { fetchWithBackoff } from './http.js';
import { MusicProviderConfigError, type MusicProvider, type Track } from './provider.js';

export const SPOTIFY_PROVIDER = 'spotify';

interface TokenResponse { access_token: string; expires_in: number; token_type: string; }

/**
 * Server-side client-credentials token manager (#19): fetches an app token and
 * refreshes it shortly before expiry. No user login, no per-request cost.
 * Tokens live in memory only and never reach the client.
 */
export class SpotifyTokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  /** Refresh this many ms before the real expiry to avoid edge-of-expiry failures. */
  private readonly skewMs = 60_000;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenUrl = cfg.spotifyTokenUrl,
  ) {
    if (!clientId || !clientSecret) {
      throw new MusicProviderConfigError(
        'Spotify provider requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET',
      );
    }
  }

  /** Returns a valid token, refreshing if expired. Concurrent callers share one refresh. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - this.skewMs) return this.token;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetchWithBackoff(this.tokenUrl, {
      method:  'POST',
      headers: {
        Authorization:  `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
    const data = (await res.json()) as TokenResponse;
    this.token     = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }
}

export class SpotifyMusicProvider implements MusicProvider {
  readonly name = SPOTIFY_PROVIDER;
  private readonly tokens: SpotifyTokenManager;

  constructor(
    clientId = cfg.spotifyClientId,
    clientSecret = cfg.spotifyClientSecret,
    private readonly apiUrl = cfg.spotifyApiUrl,
  ) {
    // Fail-fast on missing env so a misconfigured deploy never silently no-ops.
    this.tokens = new SpotifyTokenManager(clientId, clientSecret);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: string, _limit = 15, _signal?: AbortSignal): Promise<Track[]> {
    throw new MusicProviderConfigError(
      'SpotifyMusicProvider.search is a scaffold — Spotify Web API requires Premium; MVP uses iTunes. ' +
      'Implement GET ' + this.apiUrl + '/search using SpotifyTokenManager when enabling Spotify.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(_providerId: string, _signal?: AbortSignal): Promise<Track | null> {
    throw new MusicProviderConfigError(
      'SpotifyMusicProvider.resolve is a scaffold — implement GET ' + this.apiUrl + '/tracks/{id}.',
    );
  }
}
