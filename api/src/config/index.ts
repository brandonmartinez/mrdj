// Owner: Rusty (cross-cutting config — loads from root .env)
import { config } from 'dotenv';
import { resolve } from 'path';

// Load root .env; skip silently if env vars already present (e.g. docker-compose)
config({ path: resolve(process.cwd(), '../.env'), override: false });

export const cfg = {
  port:                    parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv:                 process.env.NODE_ENV ?? 'development',
  databaseUrl:             process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj',
  sessionSecret:           process.env.SESSION_SECRET ?? 'dev-secret-change-in-prod',
  isDev:                   (process.env.NODE_ENV ?? 'development') === 'development',
  // Demo auto-advance (default off; set AUTO_ADVANCE_INTERVAL_MS=30000 for 30-s demo)
  autoAdvanceIntervalMs:   parseInt(process.env.AUTO_ADVANCE_INTERVAL_MS ?? '0', 10),
  // Google OAuth2 (Epic 3). Secrets via env only — never committed.
  googleClientId:          process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret:      process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri:       process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/api/auth/google/callback',
  // Where to send the browser after a successful login (SPA).
  webBaseUrl:              process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  // ── Music providers (Epic 5) ───────────────────────────────────────────────
  // Active provider for catalog search/resolve. 'itunes' (default, no creds),
  // 'spotify' / 'apple' are scaffolds (require env; fail-fast). 'stub' = DB seed only.
  musicProvider:           (process.env.MUSIC_PROVIDER ?? 'itunes') as
                             'itunes' | 'spotify' | 'apple' | 'stub',
  // Track cache TTL (#27): cached tracks older than this are re-resolved from the
  // provider to refresh expiring preview URLs. Default 24h.
  trackCacheTtlMs:         parseInt(process.env.TRACK_CACHE_TTL_MS ?? String(24 * 60 * 60 * 1000), 10),
  // iTunes Search API (Apple public catalog — free, no credentials).
  itunesBaseUrl:           process.env.ITUNES_BASE_URL ?? 'https://itunes.apple.com',
  itunesStorefront:        process.env.ITUNES_STOREFRONT ?? 'US',
  // Spotify (scaffold — Web API now requires Premium; not wired). Secrets via env only.
  spotifyClientId:         process.env.SPOTIFY_CLIENT_ID ?? '',
  spotifyClientSecret:     process.env.SPOTIFY_CLIENT_SECRET ?? '',
  spotifyTokenUrl:         process.env.SPOTIFY_TOKEN_URL ?? 'https://accounts.spotify.com/api/token',
  spotifyApiUrl:           process.env.SPOTIFY_API_URL ?? 'https://api.spotify.com/v1',
  // Apple Music MusicKit (scaffold — fast-follow). Signed JWT dev token inputs; env only.
  appleMusicTeamId:        process.env.APPLE_MUSIC_TEAM_ID ?? '',
  appleMusicKeyId:         process.env.APPLE_MUSIC_KEY_ID ?? '',
  appleMusicPrivateKey:    process.env.APPLE_MUSIC_PRIVATE_KEY ?? '',
  appleMusicApiUrl:        process.env.APPLE_MUSIC_API_URL ?? 'https://api.music.apple.com/v1',
} as const;

