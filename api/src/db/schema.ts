// Owner: Rusty (Drizzle schema — D8 typed source of truth)
// Mirrors migrations/20260623000001_initial_schema.js EXACTLY (slice-01/02 baseline).
// No new tables/columns here — multi-tenant changes land in later epics.
//
// Mapping conventions:
//   UUID         → uuid()
//   TEXT         → text()
//   TIMESTAMPTZ  → timestamp({ withTimezone: true })
//   INTEGER      → integer()
//   BOOLEAN      → boolean()
//   DECIMAL(p,s) → numeric({ precision, scale }) (node-pg returns string)
//   gen_random_uuid() → .defaultRandom()   now() → .defaultNow()
import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, timestamp, integer, boolean, numeric, index, unique, check,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('users_type_check', sql`${t.type} IN ('guest', 'account')`),
]);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerId: text('provider_id').notNull(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('accounts_provider_provider_id_key').on(t.provider, t.providerId),
  check('accounts_role_check', sql`${t.role} IN ('user', 'admin')`),
]);

// ── Multi-tenancy (Epic 2, D7) ───────────────────────────────────────────────
// Organization = tenant (DJ business; a solo DJ is an org of one). Owns events,
// memberships, wallets/credits, pricing, and (Epic 4) the Stripe connected account.
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Membership links an Account to an Organization with an org role (replaces the
// global admin assumption from D3). Guests never have memberships.
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('staff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('memberships_org_account_key').on(t.organizationId, t.accountId),
  check('memberships_role_check', sql`${t.role} IN ('owner', 'manager', 'dj', 'staff')`),
]);

export const guestSessions = pgTable('guest_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  sessionToken: text('session_token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => accounts.id),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [
  check('events_status_check', sql`${t.status} IN ('draft', 'live', 'ended')`),
]);

// Area = optional Event subdivision (zone/stage). Every Event has at least one
// default Area; each Area owns its own queue + Play Next slot. organization_id is
// denormalized from the parent Event for direct tenant scoping via forOrg.
export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_areas_event').on(t.eventId),
]);

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  providerId: text('provider_id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  album: text('album').notNull(),
  artworkUrl: text('artwork_url').notNull().default(''),
  durationMs: integer('duration_ms').notNull().default(0),
  previewUrl: text('preview_url'),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('tracks_provider_provider_id_key').on(t.provider, t.providerId),
]);

export const queueItems = pgTable('queue_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => tracks.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  position: integer('position').notNull().default(0),
  status: text('status').notNull().default('pending'),
  isPlayNext: boolean('is_play_next').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_queue_items_event_position').on(t.eventId, t.position),
  check('queue_items_status_check', sql`${t.status} IN ('pending', 'playing', 'played', 'rejected')`),
]);

// Single-resource Play Next lock per event (see docs/ARCHITECTURE.md §2)
export const playNextSlot = pgTable('play_next_slot', {
  eventId: uuid('event_id').primaryKey().references(() => events.id, { onDelete: 'cascade' }),
  areaId: uuid('area_id').notNull().unique().references(() => areas.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('available'),
  holderQueueItemId: uuid('holder_queue_item_id').references(() => queueItems.id),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  resetAt: timestamp('reset_at', { withTimezone: true }),
}, (t) => [
  check('play_next_slot_status_check', sql`${t.status} IN ('available', 'locked', 'cooldown')`),
]);

// slice-01 deviation: wallet per user_id (not account_id) to support guest wallets.
// MVP keeps wallets unique on user_id (one org); organization_id is stamped for
// tenant accounting and forward-compat (per-org balances land with Epic 4).
export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('wallets_balance_check', sql`${t.balance} >= 0`),
]);

// Append-only credit ledger; idempotency_key guarantees no double-processing
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  referenceId: uuid('reference_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('credit_transactions_type_check', sql`${t.type} IN ('grant', 'spend', 'refund')`),
]);

// Server-side pricing config; NEVER read from frontend
export const pricingConfig = pgTable('pricing_config', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditBundles = pgTable('credit_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  credits: integer('credits').notNull(),
  bonusCredits: integer('bonus_credits').notNull().default(0),
  priceCents: integer('price_cents').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default(sql`0`),
  sortOrder: integer('sort_order').notNull().default(0),
});
