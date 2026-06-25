/**
 * Epic 4 (#8) — Marketplace payments / Stripe Connect tests.
 *
 * Covers the money path end-to-end without any network or live keys:
 *   - #20 Connect Express onboarding (idempotent account creation)
 *   - #23 account.updated → mirror charges_enabled / payouts_enabled
 *   - #26 charges_enabled guard (402 until KYC complete)
 *   - #30 guest purchase → PaymentIntent (destination charge + application fee)
 *   - #34 payment_intent.succeeded → idempotent org-scoped credit grant
 *   - #37 charge.dispute.created → flag PlatformPayment
 *   - #40 refund (money within window, credits fallback, dup, cross-org 404)
 *   - #43 per-org bundles CRUD + tenant isolation
 *   - #48 PlatformPayment ledger + platform aggregate
 *   - #55 cross-org credit spend rejection + no-overdraw under concurrency
 *
 * Strategy: a fake Stripe client is injected via setStripe() so the API surface is
 * deterministic and we can assert the exact request shapes (fee, destination,
 * idempotency keys, refund_application_fee). Webhook signature verification uses a
 * REAL Stripe instance's crypto (generateTestHeaderString / constructEvent) against a
 * test signing secret — the one thing that must not be faked.
 *
 * Run: npm test -w api  (Postgres must be up: docker compose up -d db)
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import Stripe from 'stripe';
import type { Server } from 'node:http';
import { createApp } from '../http/server.js';
import { cfg } from '../config/index.js';
import { setStripe } from '../payments/client.js';
import { applicationFeeCents } from '../payments/purchase.js';
import {
  assertWalletLedgerReconciled,
  getWalletLedgerReconciliation,
  grantCredits,
  getBalance,
  WalletLedgerDriftError,
} from '../credits/service.js';

const TEST_PORT = 3994;
const BASE   = `http://localhost:${TEST_PORT}/api`;
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';
const db     = new Pool({ connectionString: DB_URL, max: 5 });

const GUEST_USER    = '00000000-0000-0000-0000-000000000003';
const ADMIN_ACCOUNT = '00000000-0000-0000-0000-000000000002';
const ADMIN_USER    = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ORG   = '00000000-0000-0000-0000-000000000050';
const SEED_TRACK    = '00000000-0000-0000-0000-000000000101';

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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

// ── Fake Stripe (deterministic) + real Stripe (signature crypto only) ─────────
interface StripeCall { params: Record<string, unknown>; opts?: Record<string, unknown>; }
interface FakeStripe {
  _calls: { accounts: StripeCall[]; accountLinks: StripeCall[]; paymentIntents: StripeCall[]; refunds: StripeCall[] };
  accounts: { create: (p: Record<string, unknown>) => Promise<{ id: string; object: 'account' }> };
  accountLinks: { create: (p: Record<string, unknown>) => Promise<{ url: string }> };
  paymentIntents: { create: (p: Record<string, unknown>, o?: Record<string, unknown>) => Promise<Record<string, unknown>> };
  refunds: { create: (p: Record<string, unknown>, o?: Record<string, unknown>) => Promise<{ id: string }> };
  webhooks: Stripe['webhooks'];
}

let realStripe: Stripe;
let fake: FakeStripe;

function makeFake(): FakeStripe {
  const calls = { accounts: [] as StripeCall[], accountLinks: [] as StripeCall[], paymentIntents: [] as StripeCall[], refunds: [] as StripeCall[] };
  let acctSeq = 0, piSeq = 0, reSeq = 0;
  const piByKey = new Map<string, Record<string, unknown>>();
  return {
    _calls: calls,
    accounts: {
      create: async (params) => { calls.accounts.push({ params }); return { id: `acct_new_${++acctSeq}`, object: 'account' as const }; },
    },
    accountLinks: {
      create: async (params) => { calls.accountLinks.push({ params }); return { url: `https://connect.stripe.com/setup/${params.account}` }; },
    },
    paymentIntents: {
      create: async (params, opts) => {
        calls.paymentIntents.push({ params, opts });
        const key = opts?.idempotencyKey as string | undefined;
        if (key && piByKey.has(key)) return piByKey.get(key)!;
        const id = `pi_test_${++piSeq}`;
        const intent = { id, object: 'payment_intent', client_secret: `${id}_secret`, ...params };
        if (key) piByKey.set(key, intent);
        return intent;
      },
    },
    refunds: {
      create: async (params, opts) => { calls.refunds.push({ params, opts }); return { id: `re_test_${++reSeq}` }; },
    },
    webhooks: undefined as unknown as Stripe['webhooks'], // wired to realStripe.webhooks in beforeAll
  };
}

interface WebhookEvent { id: string; object: 'event'; type: string; created: number; data: { object: Record<string, unknown> }; }
function webhookEvent(type: string, dataObject: Record<string, unknown>, id = `evt_${uuid()}`): WebhookEvent {
  return { id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object: dataObject } };
}
async function postWebhook(evt: WebhookEvent, badSig = false): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(evt);
  const sig = badSig ? 't=1,v1=deadbeef' : realStripe.webhooks.generateTestHeaderString({ payload: raw, secret: cfg.stripeWebhookSecret });
  const res = await fetch(`${BASE}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function seedPendingPurchase(intentId: string, overrides: Partial<{
  userId: string; organizationId: string; bundleId: string; amountCents: number;
  applicationFeeCents: number; currency: string; creditsGranted: number; accountId: string;
}> = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO platform_payments
       (organization_id, user_id, bundle_id, stripe_payment_intent_id, amount_cents,
        application_fee_cents, currency, credits_granted, status, stripe_connected_account_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
     RETURNING id`,
    [
      overrides.organizationId ?? orgA.id,
      overrides.userId ?? BUYER,
      overrides.bundleId ?? bundleA,
      intentId,
      overrides.amountCents ?? 500,
      overrides.applicationFeeCents ?? 50,
      overrides.currency ?? 'usd',
      overrides.creditsGranted ?? 5,
      overrides.accountId ?? orgA.acct,
    ],
  );
  return rows[0].id as string;
}

async function seedPayment(intentId: string, agedDays = 0): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO platform_payments
       (organization_id, user_id, bundle_id, stripe_payment_intent_id, stripe_charge_id,
        amount_cents, application_fee_cents, currency, credits_granted, status,
        stripe_connected_account_id, created_at)
     VALUES ($1,$2,$3,$4,$5,500,50,'usd',5,'succeeded',$6, now() - ($7 || ' days')::interval)
     RETURNING id`,
    [orgA.id, BUYER, bundleA, intentId, `ch_${intentId}`, orgA.acct, String(agedDays)],
  );
  return rows[0].id as string;
}

// ── Provisioned tenants ───────────────────────────────────────────────────────
const orgA = { id: uuid(), slug: `payA-${uuid().slice(0, 8)}`, acct: `acct_orgA_${uuid().slice(0, 6)}` };
const orgB = { id: uuid(), slug: `payB-${uuid().slice(0, 8)}` };               // no Stripe account, charges disabled
const orgC = { id: uuid(), slug: `payC-${uuid().slice(0, 8)}` };               // onboarding target (no account yet)
const orgD = { id: uuid(), slug: `payD-${uuid().slice(0, 8)}`, acct: `acct_orgD_${uuid().slice(0, 6)}` }; // account.updated target
const bundleA = uuid();
const bundleAInactive = uuid();
const bundleB = uuid();
const BUYER = uuid();        // dedicated purchaser (isolated from seeded users)

// ORG_B event for the cross-org spend test (#55)
const evtB = { id: uuid(), slug: `payB-evt-${uuid().slice(0, 8)}`, areaId: uuid() };

let server: Server;
let adminCookie: string;
let guestCookie: string;

beforeAll(async () => {
  // Configure payments at runtime (cfg is a plain object; no live keys needed).
  (cfg as Record<string, unknown>).stripeSecretKey    = 'sk_test_fake';
  (cfg as Record<string, unknown>).stripeWebhookSecret = 'whsec_test_secret';
  (cfg as Record<string, unknown>).stripePublishableKey = 'pk_test_fake';
  (cfg as Record<string, unknown>).platformFeePercent = 10;
  (cfg as Record<string, unknown>).paymentsCurrency   = 'usd';

  realStripe = new Stripe('sk_test_fake', { maxNetworkRetries: 0, telemetry: false });
  fake = makeFake();
  fake.webhooks = realStripe.webhooks;
  setStripe(fake as unknown as Stripe);

  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(TEST_PORT, resolve) as Server; });
  adminCookie = await getSession('admin');
  guestCookie = await getSession('guest');

  // Orgs
  await db.query(`INSERT INTO organizations (id, slug, name, stripe_account_id, charges_enabled, payouts_enabled) VALUES ($1,$2,'Pay A',$3,true,true)`, [orgA.id, orgA.slug, orgA.acct]);
  await db.query(`INSERT INTO organizations (id, slug, name, charges_enabled) VALUES ($1,$2,'Pay B',false)`, [orgB.id, orgB.slug]);
  await db.query(`INSERT INTO organizations (id, slug, name, charges_enabled) VALUES ($1,$2,'Pay C',false)`, [orgC.id, orgC.slug]);
  await db.query(`INSERT INTO organizations (id, slug, name, stripe_account_id, charges_enabled, payouts_enabled) VALUES ($1,$2,'Pay D',$3,true,true)`, [orgD.id, orgD.slug, orgD.acct]);

  // Seeded admin gets owner membership in every test org so it can drive guarded routes.
  for (const o of [orgA, orgB, orgC, orgD]) {
    await db.query(`INSERT INTO memberships (organization_id, account_id, role) VALUES ($1,$2,'owner')`, [o.id, ADMIN_ACCOUNT]);
  }

  // Bundles
  await db.query(`INSERT INTO credit_bundles (id, organization_id, label, credits, bonus_credits, price_cents, active, sort_order) VALUES ($1,$2,'Starter',5,0,500,true,1)`, [bundleA, orgA.id]);
  await db.query(`INSERT INTO credit_bundles (id, organization_id, label, credits, bonus_credits, price_cents, active, sort_order) VALUES ($1,$2,'Retired',5,0,500,false,2)`, [bundleAInactive, orgA.id]);
  await db.query(`INSERT INTO credit_bundles (id, organization_id, label, credits, bonus_credits, price_cents, active, sort_order) VALUES ($1,$2,'B Pack',5,0,500,true,1)`, [bundleB, orgB.id]);

  // Buyer user (webhook grants land here)
  await db.query(`INSERT INTO users (id, type) VALUES ($1,'guest')`, [BUYER]);

  // ORG_B event + default area + play next slot (for #55 spend path)
  await db.query(`INSERT INTO events (id, slug, name, owner_id, organization_id, status) VALUES ($1,$2,'Pay B Bash',$3,$4,'live')`, [evtB.id, evtB.slug, ADMIN_ACCOUNT, orgB.id]);
  await db.query(`INSERT INTO areas (id, event_id, organization_id, name, is_default) VALUES ($1,$2,$3,'B Floor',true)`, [evtB.areaId, evtB.id, orgB.id]);
  await db.query(`INSERT INTO play_next_slot (event_id, area_id, status) VALUES ($1,$2,'available')`, [evtB.id, evtB.areaId]);
  await db.query(`INSERT INTO pricing_config (organization_id, key, value) VALUES ($1,'queue',0),($1,'boost',1),($1,'play_next',3)`, [orgB.id]);
});

afterAll(async () => {
  setStripe(null);
  // Clean up in FK-safe order.
  const orgIds = [orgA.id, orgB.id, orgC.id, orgD.id];
  await db.query(`DELETE FROM credit_transactions WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM platform_payments WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM wallets WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM play_next_slot WHERE event_id = $1`, [evtB.id]);
  await db.query(`DELETE FROM queue_items WHERE event_id = $1`, [evtB.id]);
  await db.query(`DELETE FROM areas WHERE event_id = $1`, [evtB.id]);
  await db.query(`DELETE FROM events WHERE id = $1`, [evtB.id]);
  await db.query(`DELETE FROM pricing_config WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM credit_bundles WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM memberships WHERE organization_id = ANY($1)`, [orgIds]);
  await db.query(`DELETE FROM users WHERE id = $1`, [BUYER]);
  await db.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgIds]);
  server?.close();
  await db.end();
});

// ── #30 fee math ──────────────────────────────────────────────────────────────
describe('applicationFeeCents (#30/O11)', () => {
  it('takes a 10% platform fee, banker-rounded', () => {
    expect(applicationFeeCents(500)).toBe(50);
    expect(applicationFeeCents(1000)).toBe(100);
    expect(applicationFeeCents(1999)).toBe(200); // 199.9 → 200
    expect(applicationFeeCents(2049)).toBe(205); // 204.9 → 205
  });
  it('honors a custom fee percent', () => {
    expect(applicationFeeCents(1000, 15)).toBe(150);
  });
});

// ── #20 Connect onboarding ──────────────────────────────────────────────────
describe('Connect Express onboarding (#20/O10)', () => {
  it('creates an Express account, stores it, and returns an onboarding link', async () => {
    const before = fake._calls.accounts.length;
    const r = await apiCall<{ accountId: string; url: string }>('POST', `/orgs/${orgC.slug}/stripe/connect`, {}, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.accountId).toMatch(/^acct_new_/);
    expect(r.body.url).toContain('connect.stripe.com');
    expect(fake._calls.accounts.length).toBe(before + 1);

    const { rows } = await db.query(`SELECT stripe_account_id FROM organizations WHERE id = $1`, [orgC.id]);
    expect(rows[0].stripe_account_id).toBe(r.body.accountId);
  });

  it('is idempotent — a second call reuses the account (no new Stripe account)', async () => {
    const before = fake._calls.accounts.length;
    const r = await apiCall<{ accountId: string }>('POST', `/orgs/${orgC.slug}/stripe/connect`, {}, adminCookie);
    expect(r.status).toBe(200);
    expect(fake._calls.accounts.length).toBe(before); // no new account created
  });

  it('reports onboarding status from mirrored flags', async () => {
    const r = await apiCall<{ connected: boolean; chargesEnabled: boolean }>('GET', `/orgs/${orgA.slug}/stripe/status`, undefined, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(true);
    expect(r.body.chargesEnabled).toBe(true);
  });

  it('requires membership — a non-member is forbidden', async () => {
    const r = await apiCall('POST', `/orgs/${orgC.slug}/stripe/connect`, {}, guestCookie);
    expect(r.status).toBe(403);
  });
});

// ── #26 charges_enabled guard ───────────────────────────────────────────────
describe('charges_enabled guard (#26/O14)', () => {
  it('blocks purchase with 402 until the org completes KYC', async () => {
    const r = await apiCall<{ error: { code: string } }>('POST', `/orgs/${orgB.slug}/credits/purchase`, { bundleId: bundleB }, guestCookie);
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('payments_unavailable');
  });

  it('allows purchase once charges are enabled', async () => {
    const r = await apiCall<{ clientSecret: string }>('POST', `/orgs/${orgA.slug}/credits/purchase`, { bundleId: bundleA }, guestCookie);
    expect(r.status).toBe(200);
    expect(r.body.clientSecret).toContain('_secret');
  });
});

// ── #30 purchase → PaymentIntent ─────────────────────────────────────────────
describe('Guest purchase → PaymentIntent (#30)', () => {
  it('creates a destination charge with the platform application fee', async () => {
    const r = await apiCall<{ applicationFeeCents: number; credits: number; amountCents: number; paymentIntentId: string }>(
      'POST', `/orgs/${orgA.slug}/credits/purchase`, { bundleId: bundleA, clientRequestId: 'click-1' }, guestCookie,
    );
    expect(r.status).toBe(200);
    expect(r.body.amountCents).toBe(500);
    expect(r.body.applicationFeeCents).toBe(50);
    expect(r.body.credits).toBe(5);

    const last = fake._calls.paymentIntents.at(-1)!;
    expect(last.params.amount).toBe(500);
    expect(last.params.application_fee_amount).toBe(50);
    expect((last.params.transfer_data as { destination: string }).destination).toBe(orgA.acct);
    expect(last.params.currency).toBe('usd');
    expect((last.params.metadata as { organizationId: string }).organizationId).toBe(orgA.id);
    expect(last.opts!.idempotencyKey).toContain('purchase-');

    const { rows } = await db.query(
      `SELECT status, amount_cents, currency, credits_granted, stripe_connected_account_id
       FROM platform_payments WHERE stripe_payment_intent_id = $1`,
      [r.body.paymentIntentId],
    );
    expect(rows[0]).toMatchObject({
      status: 'pending',
      amount_cents: 500,
      currency: 'usd',
      credits_granted: 5,
      stripe_connected_account_id: orgA.acct,
    });
  });

  it('rejects an unknown bundle with 404', async () => {
    const r = await apiCall('POST', `/orgs/${orgA.slug}/credits/purchase`, { bundleId: uuid() }, guestCookie);
    expect(r.status).toBe(404);
  });

  it('rejects an inactive bundle with 404', async () => {
    const r = await apiCall('POST', `/orgs/${orgA.slug}/credits/purchase`, { bundleId: bundleAInactive }, guestCookie);
    expect(r.status).toBe(404);
  });

  it('requires bundleId', async () => {
    const r = await apiCall('POST', `/orgs/${orgA.slug}/credits/purchase`, {}, guestCookie);
    expect(r.status).toBe(400);
  });
});

// ── #23/#34/#37 webhooks ─────────────────────────────────────────────────────
describe('Stripe webhooks (#23/#34/#37)', () => {
  it('rejects a bad signature with 400', async () => {
    const evt = webhookEvent('account.updated', { id: orgD.acct, charges_enabled: true, payouts_enabled: true });
    const r = await postWebhook(evt, true);
    expect(r.status).toBe(400);
  });

  it('rejects a missing signature header with 400', async () => {
    const res = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
  });

  it('#23 account.updated mirrors charges_enabled / payouts_enabled', async () => {
    const off = await postWebhook(webhookEvent('account.updated', { id: orgD.acct, charges_enabled: false, payouts_enabled: false }));
    expect(off.status).toBe(200);
    let { rows } = await db.query(`SELECT charges_enabled, payouts_enabled FROM organizations WHERE id = $1`, [orgD.id]);
    expect(rows[0].charges_enabled).toBe(false);

    const on = await postWebhook(webhookEvent('account.updated', { id: orgD.acct, charges_enabled: true, payouts_enabled: true }));
    expect(on.status).toBe(200);
    ({ rows } = await db.query(`SELECT charges_enabled, payouts_enabled FROM organizations WHERE id = $1`, [orgD.id]));
    expect(rows[0].charges_enabled).toBe(true);
    expect(rows[0].payouts_enabled).toBe(true);
  });

  it('#34 payment_intent.succeeded grants credits exactly once (idempotent on replay)', async () => {
    const intentId = `pi_succ_${uuid().slice(0, 8)}`;
    await seedPendingPurchase(intentId);
    const evt = webhookEvent('payment_intent.succeeded', {
      id: intentId, status: 'succeeded', latest_charge: `ch_${intentId}`, amount: 500, amount_received: 500, currency: 'usd',
      transfer_data: { destination: orgA.acct },
      metadata: { organizationId: orgB.id, userId: ADMIN_USER, bundleId: bundleB, creditsGranted: '5000', applicationFeeCents: '0' },
    }, `evt_${intentId}`);

    const r1 = await postWebhook(evt);
    expect(r1.status).toBe(200);
    expect(await getBalance(BUYER, orgA.id)).toBe(5);

    // Exact replay (same event id) → duplicate no-op.
    const r2 = await postWebhook(evt);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(await getBalance(BUYER, orgA.id)).toBe(5);

    // Different event id, SAME intent → ledger UNIQUE guard prevents a second grant.
    const evt2 = { ...evt, id: `evt_${intentId}_b` };
    const r3 = await postWebhook(evt2);
    expect(r3.status).toBe(200);
    expect(await getBalance(BUYER, orgA.id)).toBe(5);

    const { rows } = await db.query(`SELECT count(*)::int AS n, max(status) AS status FROM platform_payments WHERE stripe_payment_intent_id = $1`, [intentId]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].status).toBe('succeeded');
  });

  it('#34 ignores mismatched PaymentIntent amounts without granting credits', async () => {
    const intentId = `pi_bad_${uuid().slice(0, 8)}`;
    const before = await getBalance(BUYER, orgA.id);
    await seedPendingPurchase(intentId);
    const r = await postWebhook(webhookEvent('payment_intent.succeeded', {
      id: intentId, status: 'succeeded', latest_charge: `ch_${intentId}`, amount: 999, amount_received: 999, currency: 'usd',
      transfer_data: { destination: orgA.acct },
    }));
    expect(r.status).toBe(200);
    expect(await getBalance(BUYER, orgA.id)).toBe(before);
    const { rows } = await db.query(`SELECT status FROM platform_payments WHERE stripe_payment_intent_id = $1`, [intentId]);
    expect(rows[0].status).toBe('pending');
  });

  it('#37 charge.dispute.created flags the PlatformPayment as disputed', async () => {
    const intentId = `pi_disp_${uuid().slice(0, 8)}`;
    await seedPendingPurchase(intentId);
    await postWebhook(webhookEvent('payment_intent.succeeded', {
      id: intentId, status: 'succeeded', latest_charge: `ch_${intentId}`, amount: 500, amount_received: 500, currency: 'usd',
      transfer_data: { destination: orgA.acct },
    }, `evt_${intentId}`));

    const disp = await postWebhook(webhookEvent('charge.dispute.created', { id: `dp_${intentId}`, charge: `ch_${intentId}`, payment_intent: intentId }));
    expect(disp.status).toBe(200);
    const { rows } = await db.query(`SELECT status FROM platform_payments WHERE stripe_payment_intent_id = $1`, [intentId]);
    expect(rows[0].status).toBe('disputed');
  });

  it('ignores a PaymentIntent without a local purchase record', async () => {
    const r = await postWebhook(webhookEvent('payment_intent.succeeded', { id: `pi_nolocal_${uuid().slice(0, 8)}`, status: 'succeeded', amount: 999, currency: 'usd', metadata: {} }));
    expect(r.status).toBe(200);
  });
});

// ── #40 refunds ──────────────────────────────────────────────────────────────
describe('Refunds (#40/O7)', () => {
  it('issues a money refund within the window and reverses the application fee', async () => {
    const paymentId = await seedPayment(`pi_money_${uuid().slice(0, 8)}`);
    const before = fake._calls.refunds.length;
    const r = await apiCall<{ method: string; alreadyRefunded: boolean }>('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('money');
    expect(fake._calls.refunds.length).toBe(before + 1);
    const call = fake._calls.refunds.at(-1)!;
    expect(call.params.refund_application_fee).toBe(true);

    const { rows } = await db.query(`SELECT status FROM platform_payments WHERE id = $1`, [paymentId]);
    expect(rows[0].status).toBe('refunded');
  });

  it('is idempotent — refunding again reports alreadyRefunded', async () => {
    const paymentId = await seedPayment(`pi_dup_${uuid().slice(0, 8)}`);
    await apiCall('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie);
    const r = await apiCall<{ alreadyRefunded: boolean }>('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.alreadyRefunded).toBe(true);
  });

  it('falls back to a credit return when the refund window has elapsed', async () => {
    const paymentId = await seedPayment(`pi_old_${uuid().slice(0, 8)}`, 60); // 60 days old
    const balBefore = await getBalance(BUYER, orgA.id);
    const before = fake._calls.refunds.length;
    const r = await apiCall<{ method: string; fellBackToCredits: boolean; creditsReturned: number }>(
      'POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie,
    );
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('credits');
    expect(r.body.fellBackToCredits).toBe(true);
    expect(fake._calls.refunds.length).toBe(before); // no Stripe money refund
    expect(await getBalance(BUYER, orgA.id)).toBe(balBefore + r.body.creditsReturned);
    const { rows } = await db.query(`SELECT status, refund_method FROM platform_payments WHERE id = $1`, [paymentId]);
    expect(rows[0]).toMatchObject({ status: 'refunded', refund_method: 'credits' });
  });

  it('blocks a money refund after a credit remedy', async () => {
    const paymentId = await seedPayment(`pi_credit_then_money_${uuid().slice(0, 8)}`);
    const credit = await apiCall<{ method: string }>('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'credits' }, adminCookie);
    expect(credit.status).toBe(200);
    expect(credit.body.method).toBe('credits');

    const before = fake._calls.refunds.length;
    const money = await apiCall<{ error: { code: string; message: string } }>(
      'POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie,
    );
    expect(money.status).toBe(409);
    expect(money.body.error.code).toBe('refund_already_remedied');
    expect(fake._calls.refunds.length).toBe(before);
  });


  it('blocks a credit remedy after a money refund', async () => {
    const paymentId = await seedPayment(`pi_money_then_credit_${uuid().slice(0, 8)}`);
    const before = fake._calls.refunds.length;
    const money = await apiCall<{ method: string }>('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie);
    expect(money.status).toBe(200);
    expect(money.body.method).toBe('money');
    expect(fake._calls.refunds.length).toBe(before + 1);

    const credit = await apiCall<{ error: { code: string; message: string } }>(
      'POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'credits' }, adminCookie,
    );
    expect(credit.status).toBe(409);
    expect(credit.body.error.code).toBe('refund_already_remedied');
  });

  it('refuses to refund a payment from another org (404 tenant isolation)', async () => {
    const paymentId = await seedPayment(`pi_xorg_${uuid().slice(0, 8)}`);
    const r = await apiCall('POST', `/orgs/${orgB.slug}/payments/${paymentId}/refund`, { method: 'money' }, adminCookie);
    expect(r.status).toBe(404);
  });
});

// ── #48 ledger ───────────────────────────────────────────────────────────────
describe('PlatformPayment ledger (#48)', () => {
  async function earningsSummary(): Promise<{ grossCents: number; feeCents: number; netCents: number; refundedCount: number }> {
    const r = await apiCall<{ summary: { grossCents: number; feeCents: number; netCents: number; refundedCount: number } }>(
      'GET', `/orgs/${orgA.slug}/payments`, undefined, adminCookie,
    );
    expect(r.status).toBe(200);
    return r.body.summary;
  }

  it('returns this org\'s payments + earnings summary, scoped to the tenant', async () => {
    const r = await apiCall<{ payments: { id: string }[]; summary: { netCents: number; grossCents: number; feeCents: number } }>(
      'GET', `/orgs/${orgA.slug}/payments`, undefined, adminCookie,
    );
    expect(r.status).toBe(200);
    expect(r.body.payments.length).toBeGreaterThan(0);
    // net = gross - fee for the succeeded rows.
    expect(r.body.summary.netCents).toBe(r.body.summary.grossCents - r.body.summary.feeCents);
  });

  it('excludes credit-refunded payments from earnings', async () => {
    const before = await earningsSummary();
    const paymentId = await seedPayment(`pi_exclude_${uuid().slice(0, 8)}`);
    const refunded = await apiCall('POST', `/orgs/${orgA.slug}/payments/${paymentId}/refund`, { method: 'credits' }, adminCookie);
    expect(refunded.status).toBe(200);

    const after = await earningsSummary();
    expect(after.grossCents).toBe(before.grossCents);
    expect(after.feeCents).toBe(before.feeCents);
    expect(after.netCents).toBe(before.netCents);
    expect(after.refundedCount).toBeGreaterThan(before.refundedCount);
  });

  it('platform aggregate includes the org rollup', async () => {
    const r = await apiCall<{ organizations: { organizationId: string }[]; totals: { grossCents: number } }>('GET', '/admin/payments', undefined, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.organizations.some((o) => o.organizationId === orgA.id)).toBe(true);
  });
});

// ── #43 bundles CRUD ─────────────────────────────────────────────────────────
describe('Per-org bundles CRUD (#43)', () => {
  it('lists, creates, updates, and deletes bundles', async () => {
    const list = await apiCall<{ id: string }[]>('GET', `/orgs/${orgA.slug}/bundles`, undefined, adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.some((b) => b.id === bundleA)).toBe(true);

    const created = await apiCall<{ id: string; credits: number }>('POST', `/orgs/${orgA.slug}/bundles`, { label: 'Mega', credits: 50, bonusCredits: 10, priceCents: 4000 }, adminCookie);
    expect(created.status).toBe(201);
    expect(created.body.credits).toBe(50);

    const updated = await apiCall<{ priceCents: number }>('PATCH', `/orgs/${orgA.slug}/bundles/${created.body.id}`, { priceCents: 3500 }, adminCookie);
    expect(updated.status).toBe(200);
    expect(updated.body.priceCents).toBe(3500);

    const del = await apiCall('DELETE', `/orgs/${orgA.slug}/bundles/${created.body.id}`, undefined, adminCookie);
    expect(del.status).toBe(204);
  });

  it('rejects an invalid bundle payload', async () => {
    const r = await apiCall('POST', `/orgs/${orgA.slug}/bundles`, { label: '', credits: -1 }, adminCookie);
    expect(r.status).toBe(400);
  });

  it('cannot modify another org\'s bundle (404 tenant isolation)', async () => {
    const r = await apiCall('PATCH', `/orgs/${orgA.slug}/bundles/${bundleB}`, { priceCents: 1 }, adminCookie);
    expect(r.status).toBe(404);
  });
});

// ── #55 cross-org spend rejection (zero-tolerance) ───────────────────────────
describe('Cross-org credit spend rejection (#55)', () => {
  it('enforces organization_id scope at the DB layer — A credits are invisible at B', async () => {
    const u = uuid();
    await db.query(`INSERT INTO users (id, type) VALUES ($1,'guest')`, [u]);
    await grantCredits(u, orgA.id, 5, 'grant', `t-${u}-A`);
    expect(await getBalance(u, orgA.id)).toBe(5);
    expect(await getBalance(u, orgB.id)).toBe(0);
    await db.query(`DELETE FROM credit_transactions WHERE user_id = $1`, [u]);
    await db.query(`DELETE FROM wallets WHERE user_id = $1`, [u]);
    await db.query(`DELETE FROM users WHERE id = $1`, [u]);
  });

  it('rejects a paid request at Org B funded only by Org A credits (402)', async () => {
    // Admin holds credits in ORG_A (and the seeded default org) but none in ORG_B.
    await grantCredits(ADMIN_USER, orgA.id, 5, 'grant', `xorg-A-${uuid()}`);
    expect(await getBalance(ADMIN_USER, orgB.id)).toBe(0);

    const r = await apiCall<{ error: { code: string } }>('POST', `/events/${evtB.slug}/requests`,
      { trackId: SEED_TRACK, tier: 'boost', idempotencyKey: `xorg-${uuid()}` }, adminCookie);
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('insufficient_credits');
  });

  it('allows the same request once funded in Org B, and never overdraws under concurrency', async () => {
    // Fund exactly 3 boost credits in ORG_B.
    await grantCredits(ADMIN_USER, orgB.id, 3, 'grant', `fundB-${uuid()}`);
    expect(await getBalance(ADMIN_USER, orgB.id)).toBe(3);

    // Fire 8 concurrent boost requests (cost 1 each). The wallet balance>=0 CHECK +
    // atomic decrement must cap successes at 3 with zero overdraw.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        apiCall<{ error?: { code: string } }>('POST', `/events/${evtB.slug}/requests`,
          { trackId: SEED_TRACK, tier: 'boost', idempotencyKey: `conc-${uuid()}` }, adminCookie)),
    );
    const ok = attempts.filter((a) => a.status === 201).length;
    const declined = attempts.filter((a) => a.status === 402).length;
    expect(ok).toBe(3);
    expect(declined).toBe(5);
    expect(await getBalance(ADMIN_USER, orgB.id)).toBe(0);

    // Balance never went negative (CHECK constraint would have errored the row otherwise).
    const { rows } = await db.query(`SELECT balance FROM wallets WHERE user_id = $1 AND organization_id = $2`, [ADMIN_USER, orgB.id]);
    expect(rows[0].balance).toBe(0);
    await expect(assertWalletLedgerReconciled(ADMIN_USER, orgB.id)).resolves.toMatchObject({
      walletBalance: 0,
      ledgerBalance: 0,
      reconciled: true,
    });
  });
});

// ── Wallet/ledger reconciliation ─────────────────────────────────────────────
describe('Wallet ledger reconciliation', () => {
  it('seeded admin wallet reconciles with its grant ledger row', async () => {
    await expect(assertWalletLedgerReconciled(ADMIN_USER, DEFAULT_ORG)).resolves.toMatchObject({
      walletBalance: 100,
      ledgerBalance: 100,
      reconciled: true,
    });
  });

  it('detects mutable wallet drift from the append-only ledger', async () => {
    const u = uuid();
    await db.query(`INSERT INTO users (id, type) VALUES ($1,'guest')`, [u]);
    try {
      await grantCredits(u, orgA.id, 4, 'grant', `reconcile-${u}`);
      expect(await getWalletLedgerReconciliation(u, orgA.id)).toEqual({
        walletBalance: 4,
        ledgerBalance: 4,
        reconciled: true,
      });

      await db.query(`UPDATE wallets SET balance = balance + 1 WHERE user_id = $1 AND organization_id = $2`, [u, orgA.id]);
      expect(await getWalletLedgerReconciliation(u, orgA.id)).toEqual({
        walletBalance: 5,
        ledgerBalance: 4,
        reconciled: false,
      });
      await expect(assertWalletLedgerReconciled(u, orgA.id)).rejects.toBeInstanceOf(WalletLedgerDriftError);
    } finally {
      await db.query(`DELETE FROM credit_transactions WHERE user_id = $1`, [u]);
      await db.query(`DELETE FROM wallets WHERE user_id = $1`, [u]);
      await db.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
  });
});
