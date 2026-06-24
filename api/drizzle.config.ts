// Owner: Rusty (Drizzle Kit config — D8 data layer)
// Loads DATABASE_URL from the root .env (same convention as src/config/index.ts).
import { config } from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from 'drizzle-kit';

config({ path: resolve(process.cwd(), '../.env'), override: false });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj',
  },
  // Baseline must reproduce the live node-pg-migrate schema exactly.
  strict: true,
  verbose: true,
});
