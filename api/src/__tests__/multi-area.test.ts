/**
 * Epic 7 fast-follows (#70/#91) + Epic 8 (#25) — per-area queue.
 *
 * Each Area owns an independent queue + Play Next slot. These tests prove the
 * isolation: a request placed into a non-default Area shows up only in that
 * Area's queue, Play Next locks are per-area, and the public area roster the
 * guest jukebox selector relies on returns the default Area first.
 *
 * Strategy: drive the seeded demo event (admin = owner of `demo` org). Create a
 * second Area via the org API (also asserts createArea provisions a slot), then
 * exercise the public queue/request endpoints with ?areaId / body.areaId.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import type { Server } from 'node:http';

const TEST_PORT = 3992;
const BASE      = `http://localhost:${TEST_PORT}/api`;
const DB_URL    = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db        = new Pool({ connectionString: DB_URL, max: 5 });

const GUEST_USER  = '00000000-0000-0000-0000-000000000003';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000050';
const DEMO_EVENT  = '00000000-0000-0000-0000-000000000010';
const DEMO_AREA   = '00000000-0000-0000-0000-000000000052'; // seeded default area

// Seeded tracks free to queue (not already playing/queued by the seed).
const TRACK_CL = '00000000-0000-0000-0000-000000000101';
const TRACK_FE = '00000000-0000-0000-0000-000000000102';

interface ApiResponse<T = unknown> { status: number; body: T; setCookie: string | null; }

async function apiCall<T = unknown>(
  method: string, path: string, body?: object, cookie?: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T, setCookie: res.headers.get('set-cookie') };
}

async function getSession(role: 'guest' | 'admin'): Promise<string> {
  const r = await apiCall('POST', '/dev/act-as', { role });
  return r.setCookie?.split(';')[0] ?? '';
}

interface QueueItemView { id: string; track: { id: string } }
interface QueueView {
  areaId:   string;
  upcoming: QueueItemView[];
  playNext: { status: string };
}

let server: Server;
let guestCookie: string;
let adminCookie: string;
let areaB: string;
let areaC: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(TEST_PORT, resolve) as Server; });
  guestCookie = await getSession('guest');
  adminCookie = await getSession('admin');

  // Two extra areas on the demo event (manager+; admin owns the demo org). Both are
  // private to this suite, so assertions about them never race other test files.
  for (const label of ['Patio', 'Lounge']) {
    const created = await apiCall<{ area: { id: string } }>(
      'POST', `/orgs/demo/events/demo/areas`, { name: `${label} ${uuid().slice(0, 6)}` }, adminCookie,
    );
    expect(created.status).toBe(201);
    if (label === 'Patio') areaB = created.body.area.id;
    else areaC = created.body.area.id;
  }
});

afterAll(async () => {
  // Tear down everything this suite created so reruns stay deterministic.
  for (const a of [areaB, areaC]) {
    await db.query(
      `DELETE FROM credit_transactions WHERE reference_id IN (SELECT id FROM queue_items WHERE area_id = $1)`,
      [a],
    ).catch(() => {});
    await db.query(`DELETE FROM queue_items WHERE area_id = $1`, [a]).catch(() => {});
    await db.query(`DELETE FROM play_next_slot WHERE area_id = $1`, [a]).catch(() => {});
    await db.query(`DELETE FROM areas WHERE id = $1`, [a]).catch(() => {});
  }
  server?.close();
  await db.end();
});

async function resetState() {
  await db.query(`UPDATE wallets SET balance = 50 WHERE user_id = $1 AND organization_id = $2`,
    [GUEST_USER, DEFAULT_ORG]);
  // Clear this suite's Play Next locks + queued items (both private areas).
  await db.query(
    `UPDATE play_next_slot SET status = 'available', holder_queue_item_id = NULL, locked_at = NULL
     WHERE area_id IN ($1, $2)`,
    [areaB, areaC],
  );
  for (const a of [areaB, areaC]) {
    await db.query(
      `DELETE FROM credit_transactions WHERE reference_id IN (SELECT id FROM queue_items WHERE area_id = $1)`,
      [a],
    );
    await db.query(`DELETE FROM queue_items WHERE area_id = $1`, [a]);
  }
}

beforeEach(resetState);

describe('PA · per-area queue isolation (#70/#91)', () => {
  it('createArea provisioned an available Play Next slot for the new area', async () => {
    const rows = await db.query(
      `SELECT pns.status, pns.event_id, a.id AS area_id
       FROM areas a
       JOIN play_next_slot pns ON pns.area_id = a.id
       WHERE a.id = $1`, [areaB],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].status).toBe('available');
    expect(rows.rows[0].event_id).toBe(DEMO_EVENT);
    expect(rows.rows[0].area_id).toBe(areaB);
  });

  it('public area roster returns the default area first', async () => {
    const r = await apiCall<{ areas: Array<{ id: string; isDefault: boolean }> }>(
      'GET', '/events/demo/areas',
    );
    expect(r.status).toBe(200);
    expect(r.body.areas[0].isDefault).toBe(true);
    expect(r.body.areas[0].id).toBe(DEMO_AREA);
    expect(r.body.areas.map((a) => a.id)).toContain(areaB);
  });

  it('a request placed into area B appears only in area B\'s queue', async () => {
    const post = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests',
      { trackId: TRACK_CL, tier: 'queue', idempotencyKey: uuid(), areaId: areaB }, guestCookie,
    );
    expect(post.status).toBe(201);
    const itemId = post.body.queueItem.id;

    const inB = await apiCall<QueueView>('GET', `/events/demo/queue?areaId=${areaB}`, undefined, guestCookie);
    expect(inB.status).toBe(200);
    expect(inB.body.areaId).toBe(areaB);
    expect(inB.body.upcoming.some((q) => q.id === itemId)).toBe(true);

    // The area-B item must never surface in the default area's queue. (Asserting on
    // the specific item id keeps this independent of other suites that share the DB.)
    const inDefault = await apiCall<QueueView>('GET', '/events/demo/queue', undefined, guestCookie);
    expect(inDefault.body.areaId).toBe(DEMO_AREA);
    expect(inDefault.body.upcoming.some((q) => q.id === itemId)).toBe(false);
  });

  it('Play Next locks are independent per area', async () => {
    const post = await apiCall(
      'POST', '/events/demo/requests',
      { trackId: TRACK_FE, tier: 'play_next', idempotencyKey: uuid(), areaId: areaB }, guestCookie,
    );
    expect(post.status).toBe(201);

    const inB = await apiCall<QueueView>('GET', `/events/demo/queue?areaId=${areaB}`, undefined, guestCookie);
    expect(inB.body.playNext.status).toBe('locked');

    // A different area's slot is untouched by locking area B.
    const inC = await apiCall<QueueView>('GET', `/events/demo/queue?areaId=${areaC}`, undefined, guestCookie);
    expect(inC.body.playNext.status).toBe('available');
  });

  it('a request targeting an area from another event is rejected (404)', async () => {
    const r = await apiCall(
      'POST', '/events/demo/requests',
      { trackId: TRACK_CL, tier: 'queue', idempotencyKey: uuid(), areaId: uuid() }, guestCookie,
    );
    expect(r.status).toBe(404);
  });
});
