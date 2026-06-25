// Owner: Basher — optional demo auto-advance timer
// Enabled via AUTO_ADVANCE_INTERVAL_MS env var (e.g. 30000 = 30 s).
// Default: disabled (0). The admin /advance endpoint is the primary mechanism.
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { advanceQueue } from './index.js';

// Stable seed admin user ID for timer-driven advances
const TIMER_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

export function startAutoAdvance(intervalMs: number): NodeJS.Timeout {
  console.log(`[auto-advance] Starting — interval ${intervalMs / 1000}s`);

  return setInterval(async () => {
    try {
      // Find live events' areas that have an active playing item and at least one pending item.
      const candidates = await db.execute<{ event_id: string; area_id: string }>(sql`
        SELECT DISTINCT qi.event_id, qi.area_id
        FROM queue_items qi
        JOIN events e ON e.id = qi.event_id
        WHERE e.status = 'live'
          AND EXISTS (
            SELECT 1 FROM queue_items qi2
            WHERE qi2.area_id = qi.area_id AND qi2.status = 'playing'
          )
          AND EXISTS (
            SELECT 1 FROM queue_items qi3
            WHERE qi3.area_id = qi.area_id AND qi3.status = 'pending'
          )`);

      for (const row of candidates.rows) {
        await advanceQueue(row.event_id, TIMER_ACTOR_ID, row.area_id);
        console.log(`[auto-advance] Advanced event ${row.event_id} area ${row.area_id}`);
      }
    } catch (err) {
      // Log but don't crash the process — this is a demo helper
      console.error('[auto-advance] Error:', err instanceof Error ? err.message : err);
    }
  }, intervalMs);
}
