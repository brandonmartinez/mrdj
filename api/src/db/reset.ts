// Owner: Rusty (dev-only reset — drops the schema and re-applies migrations).
// Replaces `node-pg-migrate down/up`. Destructive: never run against prod.
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../.env'), override: false });

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index.js';
import { pool } from './pool.js';

async function main(): Promise<void> {
  console.log('[reset] Dropping public + drizzle schemas…');
  // Drop the drizzle bookkeeping schema too, so the migrator re-applies from 0000.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('CREATE SCHEMA public');

  const migrationsFolder = resolve(process.cwd(), 'drizzle');
  console.log(`[reset] Re-applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log('[reset] ✓ Schema reset + migrated');
}

main()
  .catch((err) => {
    console.error('[reset] Reset failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
