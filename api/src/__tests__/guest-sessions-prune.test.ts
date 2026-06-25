/**
 * Guest session pruning (#115).
 * Verifies the domain guest_sessions table is pruned by expires_at while fresh rows remain.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db, guestSessions, users } from '../db/index.js';
import { pruneExpiredGuestSessions } from '../guest-sessions/index.js';

const createdUserIds: string[] = [];

async function seedGuestSession(sessionToken: string, expiresAt: Date | null): Promise<string> {
  const userId = uuid();
  createdUserIds.push(userId);
  await db.insert(users).values({ id: userId, type: 'guest' });
  await db.insert(guestSessions).values({ userId, sessionToken, expiresAt });
  return userId;
}

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  createdUserIds.length = 0;
});

describe('guest session pruning', () => {
  it('deletes expired guest_sessions and leaves fresh/unexpired rows', async () => {
    const now = new Date('2026-06-25T15:11:11.299Z');
    const prefix = `prune-${uuid()}`;

    await seedGuestSession(`${prefix}-expired-old`, new Date(now.getTime() - 60_000));
    await seedGuestSession(`${prefix}-expired-at-now`, now);
    await seedGuestSession(`${prefix}-fresh`, new Date(now.getTime() + 60_000));
    await seedGuestSession(`${prefix}-no-expiry`, null);

    await expect(pruneExpiredGuestSessions(now)).resolves.toBe(2);

    const remaining = await db
      .select({ sessionToken: guestSessions.sessionToken })
      .from(guestSessions)
      .where(inArray(guestSessions.sessionToken, [
        `${prefix}-expired-old`,
        `${prefix}-expired-at-now`,
        `${prefix}-fresh`,
        `${prefix}-no-expiry`,
      ]));

    expect(remaining.map((row) => row.sessionToken).sort()).toEqual([
      `${prefix}-fresh`,
      `${prefix}-no-expiry`,
    ].sort());
  });
});
