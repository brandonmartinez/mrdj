// Migration: 20260623000001 — initial schema
// Matches docs/ARCHITECTURE.md + slice-01 adaptations:
//   • wallets.user_id (not account_id) — supports guest wallets this slice
//   • credit_transactions.user_id (not account_id) — same reason
//   TODO(Basher): migrate wallet/tx to account_id when real auth ships

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      type        TEXT        NOT NULL CHECK (type IN ('guest', 'account')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider     TEXT        NOT NULL,
      provider_id  TEXT        NOT NULL,
      email        TEXT        NOT NULL UNIQUE,
      display_name TEXT        NOT NULL,
      role         TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS guest_sessions (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      session_token  TEXT        NOT NULL UNIQUE,
      expires_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS events (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        TEXT        NOT NULL UNIQUE,
      name        TEXT        NOT NULL,
      owner_id    UUID        NOT NULL REFERENCES accounts(id),
      status      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at  TIMESTAMPTZ,
      ended_at    TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      provider     TEXT        NOT NULL,
      provider_id  TEXT        NOT NULL,
      title        TEXT        NOT NULL,
      artist       TEXT        NOT NULL,
      album        TEXT        NOT NULL,
      artwork_url  TEXT        NOT NULL DEFAULT '',
      duration_ms  INTEGER     NOT NULL DEFAULT 0,
      preview_url  TEXT,
      cached_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS queue_items (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      track_id     UUID        NOT NULL REFERENCES tracks(id),
      requester_id UUID        NOT NULL REFERENCES users(id),
      position     INTEGER     NOT NULL DEFAULT 0,
      status       TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'playing', 'played', 'rejected')),
      is_play_next BOOLEAN     NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_queue_items_event_position
      ON queue_items(event_id, position);

    -- Single-resource Play Next lock per event (see docs/ARCHITECTURE.md §2)
    CREATE TABLE IF NOT EXISTS play_next_slot (
      event_id               UUID        PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      status                 TEXT        NOT NULL DEFAULT 'available'
                                         CHECK (status IN ('available', 'locked', 'cooldown')),
      holder_queue_item_id   UUID        REFERENCES queue_items(id),
      locked_at              TIMESTAMPTZ,
      reset_at               TIMESTAMPTZ
    );

    -- slice-01 deviation: wallet per user_id (not account_id) to support guest wallets
    CREATE TABLE IF NOT EXISTS wallets (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance     INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Append-only credit ledger; idempotency_key guarantees no double-processing
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID        NOT NULL REFERENCES users(id),
      type             TEXT        NOT NULL CHECK (type IN ('grant', 'spend', 'refund')),
      amount           INTEGER     NOT NULL,
      reason           TEXT        NOT NULL,
      reference_id     UUID,
      idempotency_key  TEXT        NOT NULL UNIQUE,
      actor_id         UUID        REFERENCES users(id),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Server-side pricing config; NEVER read from frontend
    CREATE TABLE IF NOT EXISTS pricing_config (
      key         TEXT        PRIMARY KEY,
      value       INTEGER     NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS credit_bundles (
      id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      label         TEXT           NOT NULL,
      credits       INTEGER        NOT NULL,
      bonus_credits INTEGER        NOT NULL DEFAULT 0,
      price_cents   INTEGER        NOT NULL,
      discount_pct  DECIMAL(5,2)   NOT NULL DEFAULT 0,
      sort_order    INTEGER        NOT NULL DEFAULT 0
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS credit_bundles    CASCADE;
    DROP TABLE IF EXISTS pricing_config    CASCADE;
    DROP TABLE IF EXISTS credit_transactions CASCADE;
    DROP TABLE IF EXISTS wallets           CASCADE;
    DROP TABLE IF EXISTS play_next_slot    CASCADE;
    DROP TABLE IF EXISTS queue_items       CASCADE;
    DROP TABLE IF EXISTS tracks            CASCADE;
    DROP TABLE IF EXISTS events            CASCADE;
    DROP TABLE IF EXISTS guest_sessions    CASCADE;
    DROP TABLE IF EXISTS accounts          CASCADE;
    DROP TABLE IF EXISTS users             CASCADE;
  `);
};
