// Owner: Rusty (cross-cutting config — loads from root .env)
import { config } from 'dotenv';
import { resolve } from 'path';

// Load root .env; skip silently if env vars already present (e.g. docker-compose)
config({ path: resolve(process.cwd(), '../.env'), override: false });

export const cfg = {
  port:          parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv:       process.env.NODE_ENV ?? 'development',
  databaseUrl:   process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-prod',
  isDev:         (process.env.NODE_ENV ?? 'development') === 'development',
} as const;
