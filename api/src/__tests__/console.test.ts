/**
 * Slice-02 DJ Console + hardening tests.
 * Covers acceptance gates from docs/slice-02-acceptance.md:
 *   AR-01..AR-03 — admin RBAC on the new endpoints
 *   MR-01..MR-06 — O7 auto-refund on remove/reject
 *   reorder integrity (Play Next pinned, swap, edge no-op)
 *   stats shape
 *   H-01        — concurrent-spend 23514 → 402 (never 500)
 *
 * Run: npm test -w api
 * Uses an isolated Express app on TEST_PORT (3996); manipulates DB directly to assert invariants.
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import { StubAuthProvider } from '../auth/stub.js';
import type { Server } from 'node:http';

const TEST_PORT = 3996;
const BASE      = `http://localhost:${TEST_PORT}/api`;

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db     = new Pool({ connectionString: DB_URL, max: 5 });

const GUEST_USER = '00000000-0000-0000-0000-000000000003';
const ADMIN_USER = '00000000-0000-0000-0000-000000000001';
const DEMO_EVENT = '00000000-0000-0000-0000-000000000010';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000050';
const DEMO_AREA = '00000000-0000-0000-0000-000000000052';

// Seeded tracks not already playing/queued-by-default that tests can freely queue.
const TRACK_CL = '00000000-0000-0000-0000-000000000101';
const TRACK_FE = '00000000-0000-0000-0000-000000000102';
const TRACK_MS = '00000000-0000-0000-0000-000000000103';

// Seeded pending queue items (n=6..11 → positions 1..6, all owned by guest).
const QI_P1 = '00000000-0000-0000-0000-000000000206';
const QI_P2 = '00000000-0000-0000-0000-000000000207';
const QI_P6 = '00000000-0000-0000-0000-000000000211';

interface ApiResponse<T = unknown> { status: number; body: T; setCookie: string | null; }

async function apiCall<T = unknown>(
  method: string, path: string, body?: object, cookie?: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T, setCookie: res.headers.get('set-cookie') };
}

async function getSession(role: 'guest' | 'admin'): Promise<string> {
  const r = await apiCall('POST', '/dev/act-as', { role });
  return r.setCookie?.split(';')[0] ?? '';
}

async function loginDj(email: string): Promise<string> {
  const code = StubAuthProvider.encode({ providerId: `console-${email}`, email, displayName: 'Console DJ' });
  const r = await apiCall('GET', `/auth/google/callback?format=json&code=${code}`);
  expect(r.status).toBe(200);
  return r.setCookie?.split(';')[0] ?? '';
}

async function addDemoMembership(email: string, role: 'dj' | 'manager' = 'dj') {
  const { rows } = await db.query(`SELECT id FROM accounts WHERE email = $1`, [email]);
  await db.query(
    `INSERT INTO memberships (organization_id, account_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, account_id) DO UPDATE SET role = EXCLUDED.role`,
    [DEFAULT_ORG, rows[0].id, role],
  );
}

let server: Server;
let guestCookie: string;
let adminCookie: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>(resolve => { server = app.listen(TEST_PORT, resolve) as Server; });
  guestCookie = await getSession('guest');
  adminCookie = await getSession('admin');
});

afterAll(async () => {
  server?.close();
  await db.end();
});

async function resetState() {
  await db.query(`UPDATE wallets SET balance = 20 WHERE user_id = $1`, [GUEST_USER]);
  await db.query(`UPDATE wallets SET balance = 100 WHERE user_id = $1`, [ADMIN_USER]);
  await db.query(
    `UPDATE play_next_slot SET status = 'available', holder_queue_item_id = NULL, locked_at = NULL
     WHERE event_id = $1`,
    [DEMO_EVENT],
  );
  // Drop test-added items + their ledger rows (preserve seeded queue range ...0002xx).
  await db.query(
    `DELETE FROM credit_transactions WHERE reference_id IN (
       SELECT id FROM queue_items
       WHERE event_id = $1 AND id::text NOT LIKE '00000000-0000-0000-0000-0000000002%'
     )`,
    [DEMO_EVENT],
  );
  await db.query(
    `DELETE FROM queue_items
     WHERE event_id = $1 AND id::text NOT LIKE '00000000-0000-0000-0000-0000000002%'`,
    [DEMO_EVENT],
  );
  // Clear any refund rows from prior runs that referenced seeded items.
  await db.query(`DELETE FROM credit_transactions WHERE type = 'refund'`);
  // Restore seeded pending items to original positions/status.
  await db.query(
    `UPDATE queue_items SET status = 'pending', is_play_next = false, position = (
       CASE id::text
         WHEN '00000000-0000-0000-0000-000000000206' THEN 1
         WHEN '00000000-0000-0000-0000-000000000207' THEN 2
         WHEN '00000000-0000-0000-0000-000000000208' THEN 3
         WHEN '00000000-0000-0000-0000-000000000209' THEN 4
         WHEN '00000000-0000-0000-0000-000000000210' THEN 5
         WHEN '00000000-0000-0000-0000-000000000211' THEN 6
         ELSE position END)
     WHERE event_id = $1 AND id::text LIKE '00000000-0000-0000-0000-0000000002%'
       AND id::text NOT IN (
         '00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202',
         '00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000204')`,
    [DEMO_EVENT],
  );
  await db.query(
    `UPDATE queue_items SET status = 'playing', position = 0
     WHERE id = '00000000-0000-0000-0000-000000000205'`,
  );
}

async function balance(userId: string): Promise<number> {
  return (await db.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId])).rows[0].balance as number;
}

// ── AR · Admin RBAC ──────────────────────────────────────────────────────────
describe('AR · Admin RBAC on console endpoints', () => {
  beforeEach(resetState);

  it('AR-01 guest reorder → 403', async () => {
    const r = await apiCall('POST', '/admin/events/demo/reorder',
      { queueItemId: QI_P2, direction: 'up' }, guestCookie);
    expect(r.status).toBe(403);
    expect((r.body as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('AR-02 guest remove → 403', async () => {
    const r = await apiCall('POST', '/admin/events/demo/remove', { queueItemId: QI_P2 }, guestCookie);
    expect(r.status).toBe(403);
  });

  it('AR-03 guest stats → 403; admin stats → 200', async () => {
    const g = await apiCall('GET', '/admin/events/demo/stats', undefined, guestCookie);
    expect(g.status).toBe(403);
    const a = await apiCall('GET', '/admin/events/demo/stats', undefined, adminCookie);
    expect(a.status).toBe(200);
  });

  it('denies a DJ from another org and allows an org DJ', async () => {
    const wrongEmail = `wrong-org-${uuid()}@example.com`;
    const wrongCookie = await loginDj(wrongEmail);
    const wrong = await apiCall('GET', '/admin/events/demo/stats', undefined, wrongCookie);
    expect(wrong.status).toBe(403);

    const djEmail = `demo-dj-${uuid()}@example.com`;
    const djCookie = await loginDj(djEmail);
    await addDemoMembership(djEmail, 'dj');
    const allowed = await apiCall('GET', '/admin/events/demo/stats', undefined, djCookie);
    expect(allowed.status).toBe(200);
  });
});

// ── MR · O7 auto-refund on remove ────────────────────────────────────────────
describe('MR · Auto-refund on admin remove', () => {
  beforeEach(resetState);

  it('MR-01 removing a paid (boost) pending item refunds exact credits + writes a refund row', async () => {
    const key = `mr01-${uuid()}`;
    const create = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key }, guestCookie);
    expect(create.status).toBe(201);
    const qiId = create.body.queueItem.id;
    expect(await balance(GUEST_USER)).toBe(19); // 20 - 1

    const rem = await apiCall<{ refund: { userId: string; amount: number } | null }>(
      'POST', '/admin/events/demo/remove', { queueItemId: qiId }, adminCookie);
    expect(rem.status).toBe(200);
    expect(rem.body.refund).toEqual({ userId: GUEST_USER, amount: 1 });
    expect(await balance(GUEST_USER)).toBe(20); // refunded

    const refundRow = await db.query(
      `SELECT type, amount, idempotency_key FROM credit_transactions WHERE idempotency_key = $1`,
      [`refund-${qiId}`]);
    expect(refundRow.rows).toHaveLength(1);
    expect(refundRow.rows[0].type).toBe('refund');
    expect(refundRow.rows[0].amount).toBe(1);

    const item = await db.query(`SELECT status FROM queue_items WHERE id = $1`, [qiId]);
    expect(item.rows[0].status).toBe('rejected');
  });

  it('MR-02 removing a free (queue-tier) item refunds nothing', async () => {
    const key = `mr02-${uuid()}`;
    const create = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_FE, tier: 'queue', idempotencyKey: key }, guestCookie);
    expect(create.status).toBe(201);
    const qiId = create.body.queueItem.id;

    const rem = await apiCall<{ refund: unknown }>(
      'POST', '/admin/events/demo/remove', { queueItemId: qiId }, adminCookie);
    expect(rem.status).toBe(200);
    expect(rem.body.refund).toBeNull();
    expect(await balance(GUEST_USER)).toBe(20);
  });

  it('MR-03 removing the Play Next holder refunds and frees the slot', async () => {
    const key = `mr03-${uuid()}`;
    const create = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_MS, tier: 'play_next', idempotencyKey: key }, guestCookie);
    expect(create.status).toBe(201);
    const qiId = create.body.queueItem.id;
    expect(await balance(GUEST_USER)).toBe(17); // 20 - 3

    const rem = await apiCall<{ queueView: { playNext: { status: string; holderQueueItemId: string | null } }, refund: { amount: number } | null }>(
      'POST', '/admin/events/demo/remove', { queueItemId: qiId }, adminCookie);
    expect(rem.status).toBe(200);
    expect(rem.body.refund).toEqual({ userId: GUEST_USER, amount: 3 });
    expect(rem.body.queueView.playNext.status).toBe('available');
    expect(rem.body.queueView.playNext.holderQueueItemId).toBeNull();
    expect(await balance(GUEST_USER)).toBe(20);
  });

  it('MR-04 double-remove does not double-refund (2nd → 409, one refund row)', async () => {
    const key = `mr04-${uuid()}`;
    const create = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key }, guestCookie);
    const qiId = create.body.queueItem.id;

    const rem1 = await apiCall('POST', '/admin/events/demo/remove', { queueItemId: qiId }, adminCookie);
    expect(rem1.status).toBe(200);
    const rem2 = await apiCall('POST', '/admin/events/demo/remove', { queueItemId: qiId }, adminCookie);
    expect(rem2.status).toBe(409); // already rejected — only pending can be removed

    expect(await balance(GUEST_USER)).toBe(20); // refunded exactly once
    const refundRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`, [`refund-${qiId}`]);
    expect(refundRows.rows).toHaveLength(1);
  });

  it('MR-05 removing a non-existent item → 404', async () => {
    const r = await apiCall('POST', '/admin/events/demo/remove', { queueItemId: uuid() }, adminCookie);
    expect(r.status).toBe(404);
  });

  it('MR-06 cannot remove a played/playing item → 409', async () => {
    const r = await apiCall('POST', '/admin/events/demo/remove',
      { queueItemId: '00000000-0000-0000-0000-000000000205' }, adminCookie); // now-playing
    expect(r.status).toBe(409);
    expect(await balance(GUEST_USER)).toBe(20);
  });
});

// ── Reorder integrity ────────────────────────────────────────────────────────
describe('Reorder integrity', () => {
  beforeEach(resetState);

  it('swaps a pending item up with its neighbour', async () => {
    // P2 (207) up → should land at position 1, ahead of P1 (206).
    const r = await apiCall<{ queueView: { upcoming: { id: string; position: number }[] } }>(
      'POST', '/admin/events/demo/reorder', { queueItemId: QI_P2, direction: 'up' }, adminCookie);
    expect(r.status).toBe(200);
    const upcoming = r.body.queueView.upcoming;
    expect(upcoming[0].id).toBe(QI_P2);
    expect(upcoming[1].id).toBe(QI_P1);
  });

  it('edge move (last item down) is a no-op success', async () => {
    const r = await apiCall<{ queueView: { upcoming: { id: string }[] } }>(
      'POST', '/admin/events/demo/reorder', { queueItemId: QI_P6, direction: 'down' }, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.queueView.upcoming.at(-1)?.id).toBe(QI_P6);
  });

  it('Play Next holder is pinned (cannot be reordered) and nothing can move above it', async () => {
    // Guest buys play_next → becomes holder at position 1, others shift down.
    const create = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_MS, tier: 'play_next', idempotencyKey: `ro-pn-${uuid()}` }, guestCookie);
    const holderId = create.body.queueItem.id;

    // Holder itself cannot move.
    const moveHolder = await apiCall('POST', '/admin/events/demo/reorder',
      { queueItemId: holderId, direction: 'down' }, adminCookie);
    expect(moveHolder.status).toBe(409);

    // The item now directly below the holder cannot move up above it.
    const moveAbove = await apiCall('POST', '/admin/events/demo/reorder',
      { queueItemId: QI_P1, direction: 'up' }, adminCookie);
    expect(moveAbove.status).toBe(409);
  });
});

// ── Stats ────────────────────────────────────────────────────────────────────
describe('Stats endpoint', () => {
  beforeEach(resetState);

  it('returns aggregate shape with credits spent reflected', async () => {
    await apiCall('POST', '/events/demo/requests',
      { trackId: TRACK_CL, tier: 'boost', idempotencyKey: `stat-${uuid()}` }, guestCookie);

    const r = await apiCall<{ stats: {
      requestCount: number; paidRequestCount: number; creditsSpent: number;
      creditsRefunded: number; playNext: { status: string; purchasedCount: number };
      topRequesters: { userId: string; requests: number }[];
    } }>('GET', '/admin/events/demo/stats', undefined, adminCookie);

    expect(r.status).toBe(200);
    const s = r.body.stats;
    expect(s.creditsSpent).toBeGreaterThanOrEqual(1);
    expect(s.paidRequestCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(s.topRequesters)).toBe(true);
    expect(s.playNext.status).toBe('available');
  });
});

// ── H-01 · Concurrent-spend hardening (23514 → 402, never 500) ───────────────
describe('H-01 · Concurrent spend never 500s and never overspends', () => {
  beforeEach(resetState);

  it('two concurrent boosts with balance=1 → no 500, exactly one debit, balance never negative', async () => {
    await db.query(`UPDATE wallets SET balance = 1 WHERE user_id = $1`, [GUEST_USER]);

    const [r1, r2] = await Promise.all([
      apiCall('POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: `h01a-${uuid()}` }, guestCookie),
      apiCall('POST', '/events/demo/requests', { trackId: TRACK_FE, tier: 'boost', idempotencyKey: `h01b-${uuid()}` }, guestCookie),
    ]);

    expect(r1.status).not.toBe(500);
    expect(r2.status).not.toBe(500);
    // One succeeds (201), the other is rejected for funds (402).
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 402]);

    const bal = await balance(GUEST_USER);
    expect(bal).toBe(0);
    expect(bal).toBeGreaterThanOrEqual(0); // CHECK never violated into negative
  });

  describe('Console area scoping', () => {
    beforeEach(resetState);

    it('advances the selected area without advancing the default area', async () => {
      const created = await apiCall<{ area: { id: string } }>(
        'POST', '/orgs/demo/events/demo/areas', { name: `Side Room ${uuid().slice(0, 6)}` }, adminCookie,
      );
      expect(created.status).toBe(201);
      const areaId = created.body.area.id;

      const queued = await apiCall<{ queueItem: { id: string } }>(
        'POST', '/events/demo/requests',
        { trackId: TRACK_CL, tier: 'queue', idempotencyKey: `area-admin-${uuid()}`, areaId },
        guestCookie,
      );
      expect(queued.status).toBe(201);

      const advanced = await apiCall<{ queueView: { areaId: string; nowPlaying: { id: string } | null } }>(
        'POST', '/admin/events/demo/advance', { areaId }, adminCookie,
      );
      expect(advanced.status).toBe(200);
      expect(advanced.body.queueView.areaId).toBe(areaId);
      expect(advanced.body.queueView.nowPlaying?.id).toBe(queued.body.queueItem.id);

      const def = await apiCall<{ nowPlaying: { id: string } | null }>('GET', '/events/demo/queue', undefined, guestCookie);
      expect(def.status).toBe(200);
      expect(def.body.nowPlaying?.id).toBe('00000000-0000-0000-0000-000000000205');

      await db.query(`DELETE FROM credit_transactions WHERE reference_id IN (SELECT id FROM queue_items WHERE area_id = $1)`, [areaId]);
      await db.query(`DELETE FROM queue_items WHERE area_id = $1`, [areaId]);
      await db.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
      await db.query(`DELETE FROM play_next_slot WHERE area_id = $1`, [areaId]).catch(() => {});
    });
  });
});
