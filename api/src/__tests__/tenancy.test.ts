/**
 * Epic 2 (#78) — cross-tenant isolation tests.
 *
 * Proves the D7/O13 guarantees: org-scoped endpoints only ever touch the tenant in
 * the path, membership is required (being an owner of org A grants nothing in org B),
 * and reads never leak rows across the organization_id boundary.
 *
 * Strategy: the seeded admin owns the default org ("demo"). We provision a SECOND
 * org ("rival") with its own owner account + event + area directly in the DB, then
 * drive the API as the seeded admin and assert the wall holds.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import type { Server } from 'node:http';

const TEST_PORT = 3995;
const BASE      = `http://localhost:${TEST_PORT}/api`;
const DB_URL    = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db        = new Pool({ connectionString: DB_URL, max: 5 });

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
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : {}) as T,
    setCookie: res.headers.get('set-cookie'),
  };
}

async function getSession(role: 'guest' | 'admin'): Promise<string> {
  const r = await apiCall('POST', '/dev/act-as', { role });
  return r.setCookie?.split(';')[0] ?? '';
}

let server: Server;
let adminCookie: string;
let guestCookie: string;

// Rival tenant ids (provisioned in beforeAll, torn down in afterAll).
const rival = {
  orgId:     uuid(),
  userId:    uuid(),
  accountId: uuid(),
  eventId:   uuid(),
  areaId:    uuid(),
  slug:      `rival-${uuid().slice(0, 8)}`,
  eventSlug: `rival-evt-${uuid().slice(0, 8)}`,
};

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(TEST_PORT, resolve) as Server; });
  adminCookie = await getSession('admin');
  guestCookie = await getSession('guest');

  // Provision a wholly separate tenant the seeded admin has NO membership in.
  await db.query(`INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'Rival DJs')`, [rival.orgId, rival.slug]);
  await db.query(`INSERT INTO users (id, type) VALUES ($1, 'account')`, [rival.userId]);
  await db.query(
    `INSERT INTO accounts (id, user_id, provider, provider_id, email, display_name, role)
     VALUES ($1, $2, 'stub', $3, $4, 'Rival Owner', 'admin')`,
    [rival.accountId, rival.userId, `rival-${rival.userId}`, `${rival.slug}@mrdj.dev`],
  );
  await db.query(
    `INSERT INTO memberships (organization_id, account_id, role) VALUES ($1, $2, 'owner')`,
    [rival.orgId, rival.accountId],
  );
  await db.query(
    `INSERT INTO events (id, slug, name, owner_id, organization_id, status)
     VALUES ($1, $2, 'Rival Bash', $3, $4, 'live')`,
    [rival.eventId, rival.eventSlug, rival.accountId, rival.orgId],
  );
  await db.query(
    `INSERT INTO areas (id, event_id, organization_id, name, is_default)
     VALUES ($1, $2, $3, 'Rival Floor', true)`,
    [rival.areaId, rival.eventId, rival.orgId],
  );
});

afterAll(async () => {
  await db.query(`DELETE FROM areas WHERE organization_id = $1`, [rival.orgId]);
  await db.query(`DELETE FROM events WHERE organization_id = $1`, [rival.orgId]);
  await db.query(`DELETE FROM memberships WHERE organization_id = $1`, [rival.orgId]);
  await db.query(`DELETE FROM accounts WHERE id = $1`, [rival.accountId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [rival.userId]);
  await db.query(`DELETE FROM organizations WHERE id = $1`, [rival.orgId]);
  server?.close();
  await db.end();
});

describe('Epic 2 — cross-tenant isolation (#78)', () => {
  it('admin can read its OWN org', async () => {
    const r = await apiCall('GET', '/orgs/demo', undefined, adminCookie);
    expect(r.status).toBe(200);
  });

  it('member of org A is forbidden from reading org B', async () => {
    const r = await apiCall('GET', `/orgs/${rival.slug}`, undefined, adminCookie);
    expect(r.status).toBe(403);
  });

  it('member list is scoped — never leaks the rival owner', async () => {
    const r = await apiCall<{ members: Array<{ accountId: string }> }>(
      'GET', '/orgs/demo/members', undefined, adminCookie);
    expect(r.status).toBe(200);
    const ids = r.body.members.map((m) => m.accountId);
    expect(ids).not.toContain(rival.accountId);
  });

  it('cannot list members of an org you are not in', async () => {
    const r = await apiCall('GET', `/orgs/${rival.slug}/members`, undefined, adminCookie);
    expect(r.status).toBe(403);
  });

  it('area list is scoped — never leaks the rival area', async () => {
    const r = await apiCall<{ areas: Array<{ id: string }> }>(
      'GET', '/orgs/demo/events/demo/areas', undefined, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.areas.map((a) => a.id)).not.toContain(rival.areaId);
  });

  it("cannot reach a rival event through your own org's path (404, not cross-tenant read)", async () => {
    const r = await apiCall('GET', `/orgs/demo/events/${rival.eventSlug}/areas`, undefined, adminCookie);
    expect(r.status).toBe(404);
  });

  it('cannot create an area in an org you are not a member of', async () => {
    const r = await apiCall('POST', `/orgs/${rival.slug}/events/${rival.eventSlug}/areas`,
      { name: 'Hostile Takeover' }, adminCookie);
    expect(r.status).toBe(403);
  });

  it('guests (no membership) are forbidden from org endpoints', async () => {
    const r = await apiCall('GET', '/orgs/demo', undefined, guestCookie);
    expect(r.status).toBe(403);
  });

  it('unknown org slug is a 404', async () => {
    const r = await apiCall('GET', '/orgs/does-not-exist', undefined, adminCookie);
    expect(r.status).toBe(404);
  });

  it('platform-admin org list spans tenants; guests are forbidden', async () => {
    const ok = await apiCall<{ organizations: Array<{ slug: string }> }>(
      'GET', '/admin/platform/orgs', undefined, adminCookie);
    expect(ok.status).toBe(200);
    const slugs = ok.body.organizations.map((o) => o.slug);
    expect(slugs).toContain('demo');
    expect(slugs).toContain(rival.slug);

    const denied = await apiCall('GET', '/admin/platform/orgs', undefined, guestCookie);
    expect(denied.status).toBe(403);
  });
});

describe('Epic 2 — area CRUD within a tenant (#74)', () => {
  let createdAreaId: string;

  it('manager+ can create, rename, then delete a non-default area', async () => {
    const create = await apiCall<{ area: { id: string; isDefault: boolean } }>(
      'POST', '/orgs/demo/events/demo/areas', { name: 'VIP Lounge' }, adminCookie);
    expect(create.status).toBe(201);
    expect(create.body.area.isDefault).toBe(false);
    createdAreaId = create.body.area.id;

    const rename = await apiCall<{ area: { name: string } }>(
      'PATCH', `/orgs/demo/events/demo/areas/${createdAreaId}`, { name: 'VIP Deck' }, adminCookie);
    expect(rename.status).toBe(200);
    expect(rename.body.area.name).toBe('VIP Deck');

    const del = await apiCall('DELETE', `/orgs/demo/events/demo/areas/${createdAreaId}`, undefined, adminCookie);
    expect(del.status).toBe(204);
  });

  it('refuses to delete the default area', async () => {
    const list = await apiCall<{ areas: Array<{ id: string; isDefault: boolean }> }>(
      'GET', '/orgs/demo/events/demo/areas', undefined, adminCookie);
    const def = list.body.areas.find((a) => a.isDefault)!;
    const r = await apiCall('DELETE', `/orgs/demo/events/demo/areas/${def.id}`, undefined, adminCookie);
    expect(r.status).toBe(409);
  });
});
