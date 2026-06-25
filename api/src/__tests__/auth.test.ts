/**
 * Epic 3 (#92, #81, #87, #89) — auth + RBAC integration tests.
 *
 * Drives the SSO flow through the StubAuthProvider (no live Google needed) and
 * asserts: account create/link, first-login Org+owner bootstrap (#87), guest→account
 * credit merge (#89), session establishment, logout, and that protected routes
 * 401/403 by role (#92).
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { createApp } from '../http/server.js';
import { StubAuthProvider } from '../auth/stub.js';
import type { Server } from 'node:http';

const TEST_PORT = 3994;
const BASE      = `http://localhost:${TEST_PORT}/api`;
const DB_URL    = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db        = new Pool({ connectionString: DB_URL, max: 5 });

const GUEST_USER = '00000000-0000-0000-0000-000000000003';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000050';
const TRACK_CL = '00000000-0000-0000-0000-000000000101';

interface ApiResponse<T = unknown> { status: number; body: T; setCookie: string | null; }

async function apiCall<T = unknown>(
  method: string, path: string, body?: object, cookie?: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed: unknown = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed as T, setCookie: res.headers.get('set-cookie') };
}

function cookieOf(r: ApiResponse): string {
  return r.setCookie?.split(';')[0] ?? '';
}

/** Run the stub SSO callback for a given identity; returns the authed cookie + body. */
async function loginAs(
  identity: { providerId: string; email: string; displayName?: string },
  startCookie?: string,
): Promise<ApiResponse<{ organizationId: string; isNewAccount: boolean; mergedCredits: number }>> {
  const code = StubAuthProvider.encode(identity);
  return apiCall('GET', `/auth/google/callback?format=json&code=${code}`, undefined, startCookie);
}

let server: Server;
const createdEmails: string[] = [];

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(TEST_PORT, resolve) as Server; });
});

afterAll(async () => {
  // Clean up accounts/orgs created by the SSO flow.
  for (const email of createdEmails) {
    const { rows } = await db.query(`SELECT id, user_id FROM accounts WHERE email = $1`, [email]);
    for (const r of rows) {
      await db.query(`DELETE FROM memberships WHERE account_id = $1`, [r.id]);
      await db.query(`DELETE FROM wallets WHERE user_id = $1`, [r.user_id]);
      await db.query(`DELETE FROM credit_transactions WHERE user_id = $1`, [r.user_id]);
      await db.query(`DELETE FROM accounts WHERE id = $1`, [r.id]);
      await db.query(`DELETE FROM users WHERE id = $1`, [r.user_id]);
    }
  }
  await db.query(
    `DELETE FROM organizations WHERE name LIKE '%''s Organization' AND slug <> 'demo'`,
  );
  await db.query(`UPDATE wallets SET balance = 2 WHERE user_id = $1`, [GUEST_USER]);
  server?.close();
  await db.end();
});

describe('Epic 3 — SSO account lifecycle (#81/#87)', () => {
  it('first login creates an account + bootstraps an Org with an owner Membership', async () => {
    const email = `newdj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(email);
    const r = await loginAs({ providerId: `g-${email}`, email, displayName: 'New DJ' });

    expect(r.status).toBe(200);
    expect(r.body.isNewAccount).toBe(true);
    expect(r.body.organizationId).toBeTruthy();

    // Owner membership exists for the new account in the bootstrapped org.
    const { rows } = await db.query(
      `SELECT m.role FROM memberships m
       JOIN accounts a ON a.id = m.account_id
       WHERE a.email = $1 AND m.organization_id = $2`,
      [email, r.body.organizationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('owner');
  });

  it('second login with the same identity links (does not duplicate) the account', async () => {
    const email = `repeatdj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(email);
    const id = { providerId: `g-${email}`, email, displayName: 'Repeat DJ' };

    const first  = await loginAs(id);
    const second = await loginAs(id);
    expect(first.body.isNewAccount).toBe(true);
    expect(second.body.isNewAccount).toBe(false);
    expect(second.body.organizationId).toBe(first.body.organizationId);

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM accounts WHERE email = $1`, [email]);
    expect(rows[0].n).toBe(1);
  });

  it('establishes an authenticated session usable on /me', async () => {
    const email = `sessiondj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(email);
    const r = await loginAs({ providerId: `g-${email}`, email, displayName: 'Session DJ' });
    const cookie = cookieOf(r);
    const me = await apiCall<{ user: { role: string; type: string } }>('GET', '/me', undefined, cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.type).toBe('account');
    expect(me.body.user.role).toBe('dj');
  });
});


describe('Guest identity isolation', () => {
  it('creates distinct anonymous users and isolates their org wallets', async () => {
    const a = await apiCall<{ user: { id: string }, creditBalance: number }>('GET', '/me');
    const b = await apiCall<{ user: { id: string }, creditBalance: number }>('GET', '/me');
    const aCookie = cookieOf(a);
    const bCookie = cookieOf(b);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.user.id).not.toBe(GUEST_USER);
    expect(b.body.user.id).not.toBe(GUEST_USER);
    expect(a.body.user.id).not.toBe(b.body.user.id);
    expect(aCookie).toBeTruthy();
    expect(bCookie).toBeTruthy();

    await db.query(
      `INSERT INTO wallets (user_id, organization_id, balance)
       VALUES ($1, $3, 5), ($2, $3, 9)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET balance = EXCLUDED.balance`,
      [a.body.user.id, b.body.user.id, DEFAULT_ORG],
    );

    const spend = await apiCall<{ creditBalance: number }>(
      'POST',
      '/events/demo/requests',
      { trackId: TRACK_CL, tier: 'boost', idempotencyKey: `guest-iso-${uuid()}` },
      aCookie,
    );
    expect(spend.status).toBe(201);
    expect(spend.body.creditBalance).toBe(4);

    const { rows } = await db.query(
      `SELECT user_id, balance FROM wallets WHERE user_id = ANY($1::uuid[]) AND organization_id = $2`,
      [[a.body.user.id, b.body.user.id], DEFAULT_ORG],
    );
    const balances = Object.fromEntries(rows.map((r) => [r.user_id, r.balance]));
    expect(balances[a.body.user.id]).toBe(4);
    expect(balances[b.body.user.id]).toBe(9);
  });

  it('does not replay queue idempotency keys across guests or operations', async () => {
    const a = await apiCall<{ user: { id: string } }>('GET', '/me');
    const b = await apiCall<{ user: { id: string } }>('GET', '/me');
    const aCookie = cookieOf(a);
    const bCookie = cookieOf(b);
    const key = `idem-scope-${uuid()}`;

    await db.query(
      `INSERT INTO wallets (user_id, organization_id, balance)
       VALUES ($1, $3, 5), ($2, $3, 5)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET balance = EXCLUDED.balance`,
      [a.body.user.id, b.body.user.id, DEFAULT_ORG],
    );

    const first = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key }, aCookie,
    );
    expect(first.status).toBe(201);

    const retry = await apiCall<{ queueItem: { id: string } }>(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key }, aCookie,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.queueItem.id).toBe(first.body.queueItem.id);

    const otherGuest = await apiCall(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'boost', idempotencyKey: key }, bCookie,
    );
    expect(otherGuest.status).toBe(409);

    const otherOperation = await apiCall(
      'POST', '/events/demo/requests', { trackId: TRACK_CL, tier: 'queue', idempotencyKey: key }, aCookie,
    );
    expect(otherOperation.status).toBe(409);
  });
});

describe('Epic 3 — guest → account credit merge (#89)', () => {
  it('moves the pre-login guest balance into the new account wallet', async () => {
    // Start as the seeded guest and give them a known balance.
    const guestSession = await apiCall('POST', '/dev/act-as', { role: 'guest' });
    const guestCookie = cookieOf(guestSession);
    await db.query(`UPDATE wallets SET balance = 7 WHERE user_id = $1`, [GUEST_USER]);

    const email = `mergedj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(email);
    const r = await loginAs({ providerId: `g-${email}`, email, displayName: 'Merge DJ' }, guestCookie);
    const accountCookie = cookieOf(r);

    expect(r.status).toBe(200);
    expect(accountCookie).toBeTruthy();
    expect(accountCookie).not.toBe(guestCookie);
    expect(r.body.mergedCredits).toBe(7);

    // Guest wallet drained; account wallet credited.
    const { rows: guestRows } = await db.query(`SELECT balance FROM wallets WHERE user_id = $1`, [GUEST_USER]);
    expect(guestRows[0].balance).toBe(0);

    const me = await apiCall<{ creditBalance: number; user: { type: string } }>('GET', '/me', undefined, accountCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.type).toBe('account');
    expect(me.body.creditBalance).toBe(7);
  });
});

describe('Epic 3 — RBAC on protected routes (#92)', () => {
  let guestCookie: string;
  let adminCookie: string;
  let djCookie: string;

  beforeEach(async () => {
    guestCookie = cookieOf(await apiCall('POST', '/dev/act-as', { role: 'guest' }));
    adminCookie = cookieOf(await apiCall('POST', '/dev/act-as', { role: 'admin' }));
    const email = `rbacdj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(email);
    djCookie = cookieOf(await loginAs({ providerId: `g-${email}`, email, displayName: 'RBAC DJ' }));
  });

  it('guest is forbidden from platform-admin + legacy admin routes', async () => {
    const platform = await apiCall('GET', '/admin/platform/orgs', undefined, guestCookie);
    expect(platform.status).toBe(403);
    const grant = await apiCall('POST', '/admin/credits/grant',
      { targetUserId: GUEST_USER, amount: 1, idempotencyKey: uuid() }, guestCookie);
    expect(grant.status).toBe(403);
  });

  it('platform admin is allowed on platform routes', async () => {
    const r = await apiCall('GET', '/admin/platform/orgs', undefined, adminCookie);
    expect(r.status).toBe(200);
  });

  it('a freshly-signed-up DJ is NOT a platform admin', async () => {
    const r = await apiCall('GET', '/admin/platform/orgs', undefined, djCookie);
    expect(r.status).toBe(403);
  });

  it('a DJ owns their bootstrapped org but not someone else\'s', async () => {
    const emailA = `ownerdj-${uuid().slice(0, 8)}@example.com`;
    createdEmails.push(emailA);
    const a = await loginAs({ providerId: `g-${emailA}`, email: emailA, displayName: 'Owner A' });
    const aCookie = cookieOf(a);

    // Resolve own org slug, then confirm access to own org and denial of demo.
    const { rows } = await db.query(`SELECT slug FROM organizations WHERE id = $1`, [a.body.organizationId]);
    const ownSlug = rows[0].slug;

    const own = await apiCall('GET', `/orgs/${ownSlug}`, undefined, aCookie);
    expect(own.status).toBe(200);

    const foreign = await apiCall('GET', '/orgs/demo', undefined, aCookie);
    expect(foreign.status).toBe(403);
  });

  it('logout clears the session', async () => {
    const out = await apiCall('POST', '/auth/logout', undefined, djCookie);
    expect(out.status).toBe(200);
  });
});
