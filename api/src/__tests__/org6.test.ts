/**
 * Epic 6 (#32/#35/#41/#44) — self-serve org onboarding + Event CRUD.
 *
 * Covers the backend the DJ/Organization UI depends on:
 *  - GET/POST /api/me/orgs (self-serve tenant creation; current account -> owner)
 *  - Event CRUD under /api/orgs/:orgSlug/events (+ mandatory default Area)
 *
 * Strategy: drive as the seeded admin (an `account` session) who self-creates a
 * fresh org, then exercises events under it. Guests (no account) are rejected.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import type { Server } from 'node:http';

const TEST_PORT = 3993;
const BASE      = `http://localhost:${TEST_PORT}/api`;
const DB_URL    = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db        = new Pool({ connectionString: DB_URL, max: 5 });
const GUEST_USER = '00000000-0000-0000-0000-000000000003';
const TRACK_CL = '00000000-0000-0000-0000-000000000101';

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

let server: Server;
let adminCookie: string;
let guestCookie: string;

const orgSlug = `e6-${uuid().slice(0, 8)}`;
const createdOrgIds: string[] = [];
const createdEventSlugs: string[] = [];

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(TEST_PORT, resolve) as Server; });
  adminCookie = await getSession('admin');
  guestCookie = await getSession('guest');
});

afterAll(async () => {
  for (const slug of createdEventSlugs) {
    await db.query(`DELETE FROM events WHERE slug = $1`, [slug]).catch(() => {});
  }
  for (const id of createdOrgIds) {
    await db.query(`DELETE FROM organizations WHERE id = $1`, [id]).catch(() => {});
  }
  await db.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Self-serve organizations (#32/#35)', () => {
  it('guest with no account sees an empty org list', async () => {
    const r = await apiCall<{ organizations: unknown[] }>('GET', '/me/orgs', undefined, guestCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.organizations)).toBe(true);
  });

  it('guest cannot create an organization (403)', async () => {
    const r = await apiCall('POST', '/me/orgs', { slug: `g-${uuid().slice(0, 6)}`, name: 'Nope' }, guestCookie);
    expect(r.status).toBe(403);
  });

  it('rejects an invalid slug (400)', async () => {
    const r = await apiCall('POST', '/me/orgs', { slug: 'Bad Slug!', name: 'X' }, adminCookie);
    expect(r.status).toBe(400);
  });

  it('an account self-creates an org and becomes owner, with pricing seeded', async () => {
    const r = await apiCall<{ organization: { id: string; slug: string; role: string } }>(
      'POST', '/me/orgs', { slug: orgSlug, name: 'Epic Six DJs' }, adminCookie,
    );
    expect(r.status).toBe(201);
    expect(r.body.organization.slug).toBe(orgSlug);
    expect(r.body.organization.role).toBe('owner');
    createdOrgIds.push(r.body.organization.id);

    // Appears in my orgs with the owner role.
    const mine = await apiCall<{ organizations: Array<{ slug: string; role: string }> }>(
      'GET', '/me/orgs', undefined, adminCookie,
    );
    const found = mine.body.organizations.find((o) => o.slug === orgSlug);
    expect(found?.role).toBe('owner');

    // Platform-default credit bundles were seeded (O9) and are visible to the owner.
    const bundles = await apiCall<unknown[]>('GET', `/orgs/${orgSlug}/bundles`, undefined, adminCookie);
    expect(bundles.status).toBe(200);
    expect(Array.isArray(bundles.body)).toBe(true);
    expect(bundles.body.length).toBeGreaterThan(0);
  });

  it('validates organization logo URLs as HTTPS-only', async () => {
    const http = await apiCall<{ error: { code: string } }>(
      'PATCH', `/orgs/${orgSlug}`, { logoUrl: 'http://tracker.example/logo.png' }, adminCookie,
    );
    expect(http.status).toBe(400);
    expect(http.body.error.code).toBe('validation');

    const https = await apiCall<{ organization: { logoUrl: string | null } }>(
      'PATCH', `/orgs/${orgSlug}`, { logoUrl: 'https://cdn.example/logo.png' }, adminCookie,
    );
    expect(https.status).toBe(200);
    expect(https.body.organization.logoUrl).toBe('https://cdn.example/logo.png');

    const empty = await apiCall<{ organization: { logoUrl: string | null } }>(
      'PATCH', `/orgs/${orgSlug}`, { logoUrl: '' }, adminCookie,
    );
    expect(empty.status).toBe(200);
    expect(empty.body.organization.logoUrl).toBeNull();
  });

  it('duplicate slug is rejected (409)', async () => {
    const r = await apiCall('POST', '/me/orgs', { slug: orgSlug, name: 'Dup' }, adminCookie);
    expect(r.status).toBe(409);
  });
});

describe('Event CRUD (#41/#44)', () => {
  const eventSlug = `e6-evt-${uuid().slice(0, 8)}`;
  let defaultAreaId = '';

  it('manager+ creates an event with a mandatory default area', async () => {
    const r = await apiCall<{ event: { slug: string; status: string; defaultAreaId: string; defaultAreaName: string } }>(
      'POST', `/orgs/${orgSlug}/events`, { slug: eventSlug, name: 'Launch Party' }, adminCookie,
    );
    expect(r.status).toBe(201);
    expect(r.body.event.slug).toBe(eventSlug);
    expect(r.body.event.status).toBe('draft');
    expect(r.body.event.defaultAreaId).toBeTruthy();
    defaultAreaId = r.body.event.defaultAreaId;
    expect(r.body.event.defaultAreaName).toBe('Main Floor');
    createdEventSlugs.push(eventSlug);

    // The default area is queryable via the areas endpoint.
    const areas = await apiCall<{ areas: Array<{ isDefault: boolean }> }>(
      'GET', `/orgs/${orgSlug}/events/${eventSlug}/areas`, undefined, adminCookie,
    );
    expect(areas.status).toBe(200);
    expect(areas.body.areas.some((a) => a.isDefault)).toBe(true);

    const slot = await db.query(`SELECT status FROM play_next_slot WHERE area_id = $1`, [defaultAreaId]);
    expect(slot.rows[0].status).toBe('available');

    await db.query(
      `INSERT INTO wallets (user_id, organization_id, balance)
       VALUES ($1, $2, 10)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET balance = 10`,
      [GUEST_USER, createdOrgIds[0]],
    );
    const pn = await apiCall(
      'POST',
      `/events/${eventSlug}/requests`,
      { trackId: TRACK_CL, tier: 'play_next', idempotencyKey: uuid(), areaId: defaultAreaId },
      guestCookie,
    );
    expect(pn.status).toBe(201);
  });

  it('lists the org events including the new one', async () => {
    const r = await apiCall<{ events: Array<{ slug: string; areaCount: number }> }>(
      'GET', `/orgs/${orgSlug}/events`, undefined, adminCookie,
    );
    expect(r.status).toBe(200);
    const found = r.body.events.find((e) => e.slug === eventSlug);
    expect(found).toBeTruthy();
    expect(found!.areaCount).toBeGreaterThanOrEqual(1);
  });

  it('gets a single event', async () => {
    const r = await apiCall<{ event: { slug: string } }>(
      'GET', `/orgs/${orgSlug}/events/${eventSlug}`, undefined, adminCookie,
    );
    expect(r.status).toBe(200);
    expect(r.body.event.slug).toBe(eventSlug);
  });

  it('404s an unknown event in the org', async () => {
    const r = await apiCall('GET', `/orgs/${orgSlug}/events/does-not-exist`, undefined, adminCookie);
    expect(r.status).toBe(404);
  });

  it('updates the event name and transitions status to live', async () => {
    const r = await apiCall<{ event: { name: string; status: string } }>(
      'PATCH', `/orgs/${orgSlug}/events/${eventSlug}`, { name: 'Launch Party 2.0', status: 'live' }, adminCookie,
    );
    expect(r.status).toBe(200);
    expect(r.body.event.name).toBe('Launch Party 2.0');
    expect(r.body.event.status).toBe('live');

    const [row] = (await db.query(`SELECT started_at FROM events WHERE slug = $1`, [eventSlug])).rows;
    expect(row.started_at).not.toBeNull();
  });

  it('rejects an invalid status (400)', async () => {
    const r = await apiCall('PATCH', `/orgs/${orgSlug}/events/${eventSlug}`, { status: 'bogus' }, adminCookie);
    expect(r.status).toBe(400);
  });

  it('rejects a lead DJ who is not a member (400)', async () => {
    const r = await apiCall('POST', `/orgs/${orgSlug}/events`,
      { slug: `e6-evt-${uuid().slice(0, 8)}`, name: 'X', leadDjAccountId: uuid() }, adminCookie);
    expect(r.status).toBe(400);
  });

  it('duplicate event slug is rejected (409)', async () => {
    const r = await apiCall('POST', `/orgs/${orgSlug}/events`, { slug: eventSlug, name: 'Dup' }, adminCookie);
    expect(r.status).toBe(409);
  });

  it('a non-member (guest) cannot create events (403)', async () => {
    const r = await apiCall('POST', `/orgs/${orgSlug}/events`,
      { slug: `e6-evt-${uuid().slice(0, 8)}`, name: 'X' }, guestCookie);
    expect(r.status).toBe(403);
  });
});
