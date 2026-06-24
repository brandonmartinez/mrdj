// Owner: Frank (interface) | Basher (integration) — see docs/ARCHITECTURE.md §5.3
// This is the seam. Frank's webhook calls grantCredits. Basher's queue handlers
// call spendCredits. Neither reaches into the other's implementation.
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export interface CreditsResult {
  success:       boolean;
  newBalance:    number;
  transactionId: string | null;
}

/**
 * Grant credits to a user (e.g. after successful purchase).
 * Idempotent: same idempotencyKey always returns same result without re-applying.
 * MUST be called within an existing client transaction, OR will create its own.
 */
export async function grantCredits(
  userId:        string,
  amount:        number,
  reason:        string,
  idempotencyKey: string,
  actorId?:      string,
  client?:       PoolClient,
): Promise<CreditsResult> {
  const c = client ?? await pool.connect();
  const owned = !client;
  try {
    if (owned) await c.query('BEGIN');

    // Idempotency check
    const existing = await c.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const bal = await c.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
      if (owned) await c.query('COMMIT');
      return { success: true, newBalance: bal.rows[0]?.balance ?? 0, transactionId: existing.rows[0].id };
    }

    const txRow = await c.query(
      `INSERT INTO credit_transactions(user_id, type, amount, reason, idempotency_key, actor_id)
       VALUES ($1, 'grant', $2, $3, $4, $5)
       RETURNING id`,
      [userId, amount, reason, idempotencyKey, actorId ?? null],
    );
    const txId: string = txRow.rows[0].id;

    const walletRow = await c.query(
      `INSERT INTO wallets(user_id, balance, updated_at)
         VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET balance = wallets.balance + $2, updated_at = now()
       RETURNING balance`,
      [userId, amount],
    );
    const newBalance: number = walletRow.rows[0].balance;

    if (owned) await c.query('COMMIT');
    return { success: true, newBalance, transactionId: txId };
  } catch (err) {
    if (owned) await c.query('ROLLBACK').catch(() => {});

    // Race-safe idempotency recovery (Postgres 23505 = unique_violation):
    // Two concurrent grants with the same idempotencyKey can both pass the SELECT
    // idempotency check before either commits, then race on the INSERT. The loser
    // gets 23505 — recover by returning the prior result instead of a 500. The UNIQUE
    // constraint guarantees exactly one ledger row, so no double-grant ever occurs.
    // Only safe when we own the transaction; an external client's transaction is
    // already poisoned by the error and must be handled by the caller. Mirrors the
    // queue-path recovery in queue/index.ts.
    if (owned && (err as { code?: string }).code === '23505') {
      const existingTx = await pool.query(
        `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existingTx.rows[0]) {
        const bal = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
        return {
          success:       true,
          newBalance:    bal.rows[0]?.balance ?? 0,
          transactionId: existingTx.rows[0].id,
        };
      }
    }

    throw err;
  } finally {
    if (owned) c.release();
  }
}

export interface RefundResult extends CreditsResult {
  alreadyRefunded: boolean;
}

/**
 * Refund credits to a user (e.g. when an admin removes their unplayed paid request — O7).
 * Append-only: writes a `type='refund'` ledger row and credits the wallet.
 * Idempotent: the caller passes a stable idempotencyKey (e.g. `refund-<queueItemId>`), so a
 * double-remove never double-refunds (the UNIQUE constraint guarantees exactly one refund row).
 * MUST be called within an existing client transaction, OR will create its own.
 */
export async function refundCredits(
  userId:         string,
  amount:         number,
  reason:         string,
  idempotencyKey: string,
  referenceId?:   string,
  actorId?:       string,
  client?:        PoolClient,
): Promise<RefundResult> {
  const c = client ?? await pool.connect();
  const owned = !client;
  try {
    if (owned) await c.query('BEGIN');

    // Idempotency check — already refunded → return current balance, applied once.
    const existing = await c.query(
      `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const bal = await c.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
      if (owned) await c.query('COMMIT');
      return {
        success:         true,
        newBalance:      bal.rows[0]?.balance ?? 0,
        transactionId:   existing.rows[0].id,
        alreadyRefunded: true,
      };
    }

    const txRow = await c.query(
      `INSERT INTO credit_transactions(user_id, type, amount, reason, idempotency_key, reference_id, actor_id)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, amount, reason, idempotencyKey, referenceId ?? null, actorId ?? null],
    );
    const txId: string = txRow.rows[0].id;

    const walletRow = await c.query(
      `INSERT INTO wallets(user_id, balance, updated_at)
         VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET balance = wallets.balance + $2, updated_at = now()
       RETURNING balance`,
      [userId, amount],
    );

    if (owned) await c.query('COMMIT');
    return {
      success:         true,
      newBalance:      walletRow.rows[0].balance,
      transactionId:   txId,
      alreadyRefunded: false,
    };
  } catch (err) {
    if (owned) await c.query('ROLLBACK').catch(() => {});

    // Race-safe recovery (23505): a concurrent refund with the same key won the INSERT.
    // Only safe on the owned path; an external client's transaction is already poisoned.
    if (owned && (err as { code?: string }).code === '23505') {
      const existingTx = await pool.query(
        `SELECT id FROM credit_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existingTx.rows[0]) {
        const bal = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
        return {
          success:         true,
          newBalance:      bal.rows[0]?.balance ?? 0,
          transactionId:   existingTx.rows[0].id,
          alreadyRefunded: true,
        };
      }
    }

    throw err;
  } finally {
    if (owned) c.release();
  }
}

/** Read current credit balance for a user. */
export async function getBalance(userId: string): Promise<number> {
  const result = await pool.query(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.balance ?? 0;
}

// spendCredits and refundCredits are TODO(Basher) — the spend path lives in
// queue/index.ts as part of the transactional request handler.
