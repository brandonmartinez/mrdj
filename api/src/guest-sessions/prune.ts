// Owner: Basher — bounded growth for domain guest session rows (#115)
import { and, isNotNull, lte } from 'drizzle-orm';
import { db, guestSessions, type DbExecutor } from '../db/index.js';

export async function pruneExpiredGuestSessions(now: Date, executor: DbExecutor = db): Promise<number> {
  const deleted = await executor
    .delete(guestSessions)
    .where(and(
      isNotNull(guestSessions.expiresAt),
      lte(guestSessions.expiresAt, now),
    ))
    .returning({ id: guestSessions.id });

  return deleted.length;
}

export function startGuestSessionPruner(intervalMs: number): NodeJS.Timeout {
  console.log(`[guest-sessions] Starting prune timer — interval ${intervalMs / 1000}s`);

  const timer = setInterval(async () => {
    try {
      const deleted = await pruneExpiredGuestSessions(new Date());
      if (deleted > 0) console.log(`[guest-sessions] Pruned ${deleted} expired session(s)`);
    } catch (err) {
      console.error('[guest-sessions] Prune error:', err instanceof Error ? err.message : err);
    }
  }, intervalMs);

  timer.unref?.();
  return timer;
}
