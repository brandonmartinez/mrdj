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
  // ── Payments / Stripe Connect (Epic 4) ─────────────────────────────────────
  // Secrets via env only — never committed. CI/tests use nock VCR (no live keys).
  stripeSecretKey:         process.env.STRIPE_SECRET_KEY ?? '',
  stripePublishableKey:    process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  // Webhook signing secret (`whsec_…`) for verifying Stripe event signatures.
  stripeWebhookSecret:     process.env.STRIPE_WEBHOOK_SECRET ?? '',
  // Marketplace application fee taken on each guest credit purchase (O11), percent.
  platformFeePercent:      parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '10'),
  // Default settlement currency for PaymentIntents.
  paymentsCurrency:        (process.env.PAYMENTS_CURRENCY ?? 'usd').toLowerCase(),
  // Connect Express onboarding redirect targets (Account Link refresh/return).
  stripeConnectRefreshUrl: process.env.STRIPE_CONNECT_REFRESH_URL ?? 'http://localhost:5173/connect/refresh',
  stripeConnectReturnUrl:  process.env.STRIPE_CONNECT_RETURN_URL ?? 'http://localhost:5173/connect/return',
  // Window (ms) during which a card refund may still be issued (O7). Default 30 days.
  refundWindowMs:          parseInt(process.env.REFUND_WINDOW_MS ?? String(30 * 24 * 60 * 60 * 1000), 10),
  // ── Guest rate limiting (Epic 9 hardening, #57) ────────────────────────────
  // Coarse per-IP + per-session abuse guard on guest request-submit and search.
  // Off in development (so the dev loop + test suite aren't throttled), on otherwise.
  // Override explicitly with RATE_LIMIT_ENABLED=true|false.
  rateLimitEnabled:        (process.env.RATE_LIMIT_ENABLED
                             ?? ((process.env.NODE_ENV ?? 'development') === 'development' ? 'false' : 'true')) === 'true',
  rateLimitWindowMs:       parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  rateLimitRequestPerIp:      parseInt(process.env.RATE_LIMIT_REQUEST_PER_IP ?? '60', 10),
  rateLimitRequestPerSession: parseInt(process.env.RATE_LIMIT_REQUEST_PER_SESSION ?? '20', 10),
  rateLimitSearchPerIp:       parseInt(process.env.RATE_LIMIT_SEARCH_PER_IP ?? '120', 10),
  rateLimitSearchPerSession:  parseInt(process.env.RATE_LIMIT_SEARCH_PER_SESSION ?? '40', 10),
} as const;

