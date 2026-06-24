// Owner: Rusty (migration runner — Drizzle programmatic migrator, replaces node-pg-migrate).
// Applies pending migrations from ./drizzle. Idempotent: drizzle-orm tracks applied
// migrations in drizzle.__drizzle_migrations, so re-running is a no-op once up to date.
// Uses the runtime drizzle-orm dependency (not the drizzle-kit CLI) so it works in the
// built image / docker-compose entrypoint without dev tooling.
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../.env'), override: false });

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index.js';
import { pool } from './pool.js';

async function main(): Promise<void> {
  const migrationsFolder = resolve(process.cwd(), 'drizzle');
  console.log(`[migrate] Applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] ✓ Migrations up to date');
}

main()
  .catch((err) => {
    console.error('[migrate] Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
