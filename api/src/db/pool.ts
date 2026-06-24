// Owner: Rusty (DB pool — PgBouncer-safe)
// RULE: never pass { name: '...' } to pool.query — named prepared statements break
// PgBouncer transaction-pooling mode. Always use pool.query(text, params).
import { Pool } from 'pg';
import { cfg } from '../config/index.js';

export const pool = new Pool({
  connectionString: cfg.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

/** Wait for DB to be reachable (retries with fixed delay). */
export async function waitForDb(retries = 20, delayMs = 2_000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[db] waiting… (attempt ${i + 1}/${retries}) — ${msg}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('[db] Could not connect after max retries');
}
