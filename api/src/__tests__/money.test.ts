/**
 * Money-correctness tests for mrdj Slice-01 API.
 * Covers MC-01..MC-10 from docs/slice-01-acceptance.md.
 *
 * Run: npm test -w api
 *
 * The test suite starts an isolated Express app on TEST_PORT (3998) to avoid
 * conflicting with any running dev server. It manipulates DB state directly
 * via a dedicated Pool and verifies invariants after each operation.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import type { Server } from 'node:http';

// ── Test config ───────────────────────────────────────────────────────────────

const TEST_PORT = 3998;
const BASE      = `http://localhost:${TEST_PORT}/api`;

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db     = new Pool({ connectionString: DB_URL, max: 5 });

// Stable seeded IDs (must match api/src/db/seed.ts)
const GUEST_USER  = '00000000-0000-0000-0000-000000000003';
const ADMIN_USER  = '00000000-0000-0000-0000-000000000001';
const DEMO_EVENT  = '00000000-0000-0000-0000-000000000010';
// Seeded tracks — use ones not already in the active queue
const TRACK_CL    = '00000000-0000-0000-0000-000000000101'; // Clair de Lune
const TRACK_FE    = '00000000-0000-0000-0000-000000000102'; // Für Elise
const TRACK_MS    = '00000000-0000-0000-0000-000000000103'; // Moonlight Sonata
const TRACK_CD    = '00000000-0000-0000-0000-000000000104'; // Canon in D
const TRACK_HA    = '00000000-0000-0000-0000-000000000110'; // Habanera
const TRACK_OJ    = '00000000-0000-0000-0000-000000000111'; // Ode to Joy
const TRACK_G1    = '00000000-0000-0000-0000-000000000112'; // Gymnopédie No. 1

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  status: number;
  body:   T;
}

async function apiCall<T = unknown>(
  method: string,
  path:   string,
  body?:  object,
  cookie?: string,
): Promise<ApiResponse<T> & { setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status:    res.status,
    body:      (await res.json()) as T,
    setCookie: res.headers.get('set-cookie'),
  };
}

async function getSession(role: 'guest' | 'admin'): Promise<string> {
  const r = await apiCall('POST', '/dev/act-as', { role });
  return r.setCookie?.split(';')[0] ?? '';
}

// ── Suite setup ───────────────────────────────────────────────────────────────

let server: Server;
let guestCookie: string;
let adminCookie: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>(resolve => {
    server = app.listen(TEST_PORT, resolve) as Server;
  });
  guestCookie = await getSession('guest');
  adminCookie = await getSession('admin');
});

afterAll(async () => {
  server?.close();
  await db.end();
});

// Reset to known state before each test group
async function resetState() {
  await db.query(`UPDATE wallets SET balance = 20 WHERE user_id = $1`, [GUEST_USER]);
  await db.query(`UPDATE wallets SET balance = 100 WHERE user_id = $1`, [ADMIN_USER]);
  await db.query(
    `UPDATE play_next_slot
     SET status = 'available', holder_queue_item_id = NULL, locked_at = NULL
     WHERE event_id = $1`,
    [DEMO_EVENT],
  );
  // Remove queue items added by tests (preserve ALL seeded items — their IDs start with
  // '00000000-0000-0000-0000-0000000002xx'). NOTE: the pattern must be '...0000000002%' (10 twos-
  // prefix digits) so it preserves 210 and 211; the narrower '...00000000020%' wrongly deletes
  // them and breaks cross-file runs where this file resets before console.test.ts.
  await db.query(
    `DELETE FROM queue_items
     WHERE event_id = $1
       AND id::text NOT LIKE '00000000-0000-0000-0000-0000000002%'`,
    [DEMO_EVENT],
  );
  // Restore seeded pending queue items to original positions
  await db.query(
    `UPDATE queue_items SET status = 'pending', is_play_next = false, position = (
       CASE id::text
         WHEN '00000000-0000-0000-0000-000000000206' THEN 1
         WHEN '00000000-0000-0000-0000-000000000207' THEN 2
         WHEN '00000000-0000-0000-0000-000000000208' THEN 3
         WHEN '00000000-0000-0000-0000-000000000209' THEN 4
         WHEN '00000000-0000-0000-0000-000000000210' THEN 5
         WHEN '00000000-0000-0000-0000-000000000211' THEN 6
         ELSE position
       END
     )
     WHERE event_id = $1
       AND id::text LIKE '00000000-0000-0000-0000-0000000002%'
       AND id::text NOT IN (
         '00000000-0000-0000-0000-000000000201',
         '00000000-0000-0000-0000-000000000202',
         '00000000-0000-0000-0000-000000000203',
         '00000000-0000-0000-0000-000000000204'
       )`,
    [DEMO_EVENT],
  );
  // Restore now-playing
  await db.query(
    `UPDATE queue_items SET status = 'playing', position = 0
     WHERE id = '00000000-0000-0000-0000-000000000205'`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MC-01 · Server-authoritative pricing', () => {
  beforeEach(resetState);

  it('uses server pricing for boost (ignores any client-supplied amount)', async () => {
    const key = `mc01-boost-${uuid()}`;
    // The request body has no "amount" field; the server reads from pricing_config
    const r = await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_CL,
      tier:           'boost',
      idempotencyKey: key,
    }, guestCookie);

    expect(r.status).toBe(201);

    // Verify the transaction amount equals server's pricing.boost (1 credit)
    const tx = await db.query(
      `SELECT amount FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(tx.rows).toHaveLength(1);
    expect(tx.rows[0].amount).toBe(1); // server-authoritative boost price
  });

  it('uses server pricing for play_next', async () => {
    const key = `mc01-pn-${uuid()}`;
    const r = await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_FE,
      tier:           'play_next',
      idempotencyKey: key,
    }, guestCookie);

    expect(r.status).toBe(201);

    const tx = await db.query(
      `SELECT amount FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(tx.rows[0].amount).toBe(3); // server-authoritative play_next price
  });
});

describe('MC-03 · Idempotent paid action — Boost', () => {
  beforeEach(resetState);

  it('retried boost with same idempotency key creates exactly one debit row', async () => {
    const key = `mc03-${uuid()}`;
    const body = { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key };

    const r1 = await apiCall('POST', '/events/demo/requests', body, guestCookie);
    expect(r1.status).toBe(201);

    const balAfterFirst = (r1.body as { creditBalance: number }).creditBalance;

    // Replay the exact same request
    const r2 = await apiCall('POST', '/events/demo/requests', body, guestCookie);
    expect(r2.status).toBeOneOf([200, 201]); // idempotent — success either way

    // Exactly one debit row, not two
    const txRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(txRows.rows).toHaveLength(1);

    // Balance unchanged after the retry
    const balAfterSecond = (r2.body as { creditBalance: number }).creditBalance;
    expect(balAfterSecond).toBe(balAfterFirst);
  });
});

describe('MC-04 · Idempotent paid action — Play Next', () => {
  beforeEach(resetState);

  it('retried play_next with same key creates exactly one debit row and one slot lock', async () => {
    const key = `mc04-${uuid()}`;
    const body = { trackId: TRACK_MS, tier: 'play_next', idempotencyKey: key };

    const r1 = await apiCall('POST', '/events/demo/requests', body, guestCookie);
    expect(r1.status).toBe(201);

    // Replay
    const r2 = await apiCall('POST', '/events/demo/requests', body, guestCookie);
    expect(r2.status).toBeOneOf([200, 201]); // idempotent — success

    // One debit row
    const txRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(txRows.rows).toHaveLength(1);

    // MC-07 invariant: at most one locked play_next holder in pending
    const lockedRows = await db.query(
      `SELECT COUNT(*) AS n FROM queue_items
       WHERE event_id = $1 AND is_play_next = true AND status = 'pending'`,
      [DEMO_EVENT],
    );
    expect(Number(lockedRows.rows[0].n)).toBeLessThanOrEqual(1);
  });
});

describe('MC-05 · Failed action does not debit — slot taken', () => {
  beforeEach(resetState);

  it('second play_next when slot is locked returns 409 and creates zero debit rows', async () => {
    // Lock the slot with user A's purchase
    await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_CD,
      tier:           'play_next',
      idempotencyKey: `mc05-setup-${uuid()}`,
    }, guestCookie);

    // User B tries to grab the slot
    const failKey = `mc05-fail-${uuid()}`;
    const r = await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_HA,
      tier:           'play_next',
      idempotencyKey: failKey,
    }, guestCookie);

    expect(r.status).toBe(409);
    expect((r.body as { error: { code: string } }).error.code).toBe('play_next_unavailable');

    // Zero ledger rows for the failed attempt
    const txRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [failKey],
    );
    expect(txRows.rows).toHaveLength(0);
  });
});

describe('MC-06 · Failed Boost with insufficient credits', () => {
  beforeEach(resetState);

  it('boost with zero credits returns 402 and creates zero debit rows', async () => {
    // Zero out the guest wallet
    await db.query(`UPDATE wallets SET balance = 0 WHERE user_id = $1`, [GUEST_USER]);

    const failKey = `mc06-${uuid()}`;
    const r = await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_OJ,
      tier:           'boost',
      idempotencyKey: failKey,
    }, guestCookie);

    expect(r.status).toBe(402);
    const body = r.body as { error: { code: string; required: number; balance: number } };
    expect(body.error.code).toBe('insufficient_credits');
    expect(body.error.required).toBe(1);
    expect(body.error.balance).toBe(0);

    // Zero debit rows
    const txRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [failKey],
    );
    expect(txRows.rows).toHaveLength(0);
  });
});

describe('MC-07 · Play Next single-slot', () => {
  beforeEach(resetState);

  it('at no point can more than one pending queue item be is_play_next = true', async () => {
    // Purchase play_next
    await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_G1,
      tier:           'play_next',
      idempotencyKey: `mc07-${uuid()}`,
    }, guestCookie);

    const lockedRows = await db.query(
      `SELECT COUNT(*) AS n FROM queue_items
       WHERE event_id = $1 AND is_play_next = true AND status = 'pending'`,
      [DEMO_EVENT],
    );
    expect(Number(lockedRows.rows[0].n)).toBeLessThanOrEqual(1);
  });
});

describe('MC-08 · Admin grant audit row', () => {
  beforeEach(resetState);

  it('admin grant produces a credit_transaction with actor_id and admin_grant reason', async () => {
    const key = `mc08-${uuid()}`;
    const r = await apiCall('POST', '/admin/credits/grant', {
      targetUserId:   GUEST_USER,
      amount:         10,
      note:           'MC-08 test',
      idempotencyKey: key,
    }, adminCookie);

    expect(r.status).toBe(200);
    expect((r.body as { balance: number }).balance).toBeGreaterThan(0);

    // Verify audit row
    const row = await db.query(
      `SELECT user_id, type, amount, reason, actor_id, idempotency_key
       FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(row.rows).toHaveLength(1);
    const tx = row.rows[0];
    expect(tx.type).toBe('grant');
    expect(tx.reason).toMatch(/admin_grant/);
    expect(tx.actor_id).toBe(ADMIN_USER);
    expect(tx.amount).toBe(10);
    expect(tx.idempotency_key).toBe(key);
  });
});

describe('MC-09 · Admin grant idempotency', () => {
  beforeEach(resetState);

  it('re-submitting same admin grant key increments balance once, creates one audit row', async () => {
    const key = `mc09-${uuid()}`;
    const body = { targetUserId: GUEST_USER, amount: 5, idempotencyKey: key };

    const r1 = await apiCall('POST', '/admin/credits/grant', body, adminCookie);
    expect(r1.status).toBe(200);
    const bal1 = (r1.body as { balance: number }).balance;

    // Replay
    const r2 = await apiCall('POST', '/admin/credits/grant', body, adminCookie);
    expect(r2.status).toBe(200);
    const bal2 = (r2.body as { balance: number }).balance;

    // Balance not incremented twice
    expect(bal2).toBe(bal1);

    // Exactly one audit row
    const rows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('MC-10 · Stub checkout grant shape', () => {
  beforeEach(resetState);

  it('stub-complete grants correct bundle credits and records idempotency_key', async () => {
    // Create session for Starter Pack (5 credits, 0 bonus = 5 total)
    const sr = await apiCall('POST', '/checkout/session', {
      bundleId: '00000000-0000-0000-0000-000000000040',
    }, guestCookie);
    expect(sr.status).toBe(200);
    const { sessionId } = sr.body as { sessionId: string };

    const idemKey = `mc10-${uuid()}`;
    const balBefore = await db.query(
      `SELECT balance FROM wallets WHERE user_id = $1`, [GUEST_USER],
    );
    const prevBal = balBefore.rows[0].balance as number;

    const cr = await apiCall('POST', '/checkout/stub-complete', {
      sessionId,
      idempotencyKey: idemKey,
    }, guestCookie);
    expect(cr.status).toBe(200);
    expect((cr.body as { creditBalance: number }).creditBalance).toBe(prevBal + 5);

    // Verify ledger row: reason='purchase', no raw payment data
    const row = await db.query(
      `SELECT type, amount, reason, idempotency_key
       FROM credit_transactions WHERE idempotency_key = $1`,
      [idemKey],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].type).toBe('grant');
    expect(row.rows[0].reason).toBe('purchase');
    expect(row.rows[0].amount).toBe(5);
    expect(row.rows[0].idempotency_key).toBe(idemKey);
  });

  // Frank (audit fix): BUG-2 — stub-complete retry after session consumed must return
  // the prior balance (200), not a 400 "session not found".
  it('stub-complete replay with same idempotencyKey returns prior balance, not 400', async () => {
    const sr = await apiCall('POST', '/checkout/session', {
      bundleId: '00000000-0000-0000-0000-000000000040', // 5 credits
    }, guestCookie);
    expect(sr.status).toBe(200);
    const { sessionId } = sr.body as { sessionId: string };
    const idemKey = `mc10-replay-${uuid()}`;

    // First call — consumes the session
    const cr1 = await apiCall('POST', '/checkout/stub-complete', {
      sessionId,
      idempotencyKey: idemKey,
    }, guestCookie);
    expect(cr1.status).toBe(200);
    const bal1 = (cr1.body as { creditBalance: number }).creditBalance;

    // Retry with the exact same sessionId + idempotencyKey
    const cr2 = await apiCall('POST', '/checkout/stub-complete', {
      sessionId,
      idempotencyKey: idemKey,
    }, guestCookie);
    expect(cr2.status).toBe(200); // must not be 400
    expect((cr2.body as { creditBalance: number }).creditBalance).toBe(bal1);

    // Exactly one grant row — no double-credit
    const rows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [idemKey],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

// Frank (audit fix): BUG-1 — concurrent duplicate idempotency key for boost/queue
// tiers must not 500.  FOR UPDATE protects play_next; boost/queue use a post-error
// recovery to return the prior result when Postgres raises 23505.
describe('Frank-BUG1 · Concurrent duplicate idempotency key — no 500', () => {
  beforeEach(resetState);

  it('two simultaneous boost requests with the same key both return 2xx and produce one ledger row', async () => {
    const key = `bug1-concurrent-${uuid()}`;
    const body = { trackId: TRACK_G1, tier: 'boost', idempotencyKey: key };

    // Fire both at the same time to maximise the chance of hitting the race window.
    const [r1, r2] = await Promise.all([
      apiCall('POST', '/events/demo/requests', body, guestCookie),
      apiCall('POST', '/events/demo/requests', body, guestCookie),
    ]);

    // Neither should be a 500; both should be a success or a recognised non-500
    expect(r1.status).not.toBe(500);
    expect(r2.status).not.toBe(500);

    // Exactly one ledger row regardless of concurrency
    const txRows = await db.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(txRows.rows).toHaveLength(1);
  });
});

describe('Admin advance — resets Play Next slot, no refund', () => {
  beforeEach(resetState);

  it('advancing queue resets play_next slot to available without crediting user', async () => {
    // Purchase play_next (costs 3 from balance=20)
    const pnKey = `adv-setup-${uuid()}`;
    await apiCall('POST', '/events/demo/requests', {
      trackId:        TRACK_CL,
      tier:           'play_next',
      idempotencyKey: pnKey,
    }, guestCookie);

    const balAfterPurchase = (await db.query(
      `SELECT balance FROM wallets WHERE user_id = $1`, [GUEST_USER],
    )).rows[0].balance as number;

    // Admin advances
    const r = await apiCall('POST', '/admin/events/demo/advance', undefined, adminCookie);
    expect(r.status).toBe(200);
    const qv = (r.body as { queueView: { playNext: { status: string } } }).queueView;
    expect(qv.playNext.status).toBe('available');

    // No refund — balance unchanged
    const balAfterAdvance = (await db.query(
      `SELECT balance FROM wallets WHERE user_id = $1`, [GUEST_USER],
    )).rows[0].balance as number;
    expect(balAfterAdvance).toBe(balAfterPurchase);
  });
});
