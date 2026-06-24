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
} as const;

