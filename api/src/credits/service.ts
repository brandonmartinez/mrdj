// Owner: Frank (interface) | Basher (integration) — see docs/ARCHITECTURE.md §5.3
// This is the seam. Frank's webhook calls grantCredits. Basher's queue handlers
// call spendCredits. Neither reaches into the other's implementation.
import { and, eq, sql } from 'drizzle-orm';
import { db, creditTransactions, wallets, pgErrorCode, type DbExecutor } from '../db/index.js';

export interface CreditsResult {
  success:       boolean;
  newBalance:    number;
  transactionId: string | null;
}

/**
 * Grant credits to a user (e.g. after successful purchase).
 * Idempotent: same idempotencyKey always returns same result without re-applying.
 * Pass `executor` (a tx) to enlist in an existing transaction, OR omit to create its own.
 */
export async function grantCredits(
  userId:         string,
  organizationId: string,
  amount:         number,
  reason:         string,
  idempotencyKey: string,
  actorId?:       string,
  executor?:      DbExecutor,
): Promise<CreditsResult> {
  const run = async (ex: DbExecutor): Promise<CreditsResult> => {
    // Idempotency check
    const [existing] = await ex
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
    if (existing) {
      const [bal] = await ex.select({ balance: wallets.balance }).from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.organizationId, organizationId)));
      return { success: true, newBalance: bal?.balance ?? 0, transactionId: existing.id };
    }

    const [txRow] = await ex
      .insert(creditTransactions)
      .values({ userId, organizationId, type: 'grant', amount, reason, idempotencyKey, actorId: actorId ?? null })
      .returning({ id: creditTransactions.id });

    const [walletRow] = await ex
      .insert(wallets)
      .values({ userId, organizationId, balance: amount })
      .onConflictDoUpdate({
        target: [wallets.userId, wallets.organizationId],
        set:    { balance: sql`${wallets.balance} + ${amount}`, updatedAt: sql`now()` },
      })
      .returning({ balance: wallets.balance });

    return { success: true, newBalance: walletRow.balance, transactionId: txRow.id };
  };

  // Caller owns the transaction → run on their executor; their tx handles commit/rollback.
  if (executor) return run(executor);

  // We own the transaction. Drizzle BEGIN/COMMIT/ROLLBACK is automatic.
  try {
    return await db.transaction((tx) => run(tx));
  } catch (err) {
    // Race-safe idempotency recovery (Postgres 23505 = unique_violation):
    // Two concurrent grants with the same idempotencyKey can both pass the SELECT
    // idempotency check before either commits, then race on the INSERT. The loser
    // gets 23505 — recover by returning the prior result instead of a 500. The UNIQUE
    // constraint guarantees exactly one ledger row, so no double-grant ever occurs.
    // The transaction is already rolled back, so recover with fresh (non-tx) queries.
    if (pgErrorCode(err) === '23505') {
      const [existingTx] = await db
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
      if (existingTx) {
        const [bal] = await db.select({ balance: wallets.balance }).from(wallets)
          .where(and(eq(wallets.userId, userId), eq(wallets.organizationId, organizationId)));
        return { success: true, newBalance: bal?.balance ?? 0, transactionId: existingTx.id };
      }
    }
    throw err;
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
 * Pass `executor` (a tx) to enlist in an existing transaction, OR omit to create its own.
 */
export async function refundCredits(
  userId:         string,
  organizationId: string,
  amount:         number,
  reason:         string,
  idempotencyKey: string,
  referenceId?:   string,
  actorId?:       string,
  executor?:      DbExecutor,
): Promise<RefundResult> {
  const run = async (ex: DbExecutor): Promise<RefundResult> => {
    // Idempotency check — already refunded → return current balance, applied once.
    const [existing] = await ex
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
    if (existing) {
      const [bal] = await ex.select({ balance: wallets.balance }).from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.organizationId, organizationId)));
      return { success: true, newBalance: bal?.balance ?? 0, transactionId: existing.id, alreadyRefunded: true };
    }

    const [txRow] = await ex
      .insert(creditTransactions)
      .values({ userId, organizationId, type: 'refund', amount, reason, idempotencyKey, referenceId: referenceId ?? null, actorId: actorId ?? null })
      .returning({ id: creditTransactions.id });

    const [walletRow] = await ex
      .insert(wallets)
      .values({ userId, organizationId, balance: amount })
      .onConflictDoUpdate({
        target: [wallets.userId, wallets.organizationId],
        set:    { balance: sql`${wallets.balance} + ${amount}`, updatedAt: sql`now()` },
      })
      .returning({ balance: wallets.balance });

    return { success: true, newBalance: walletRow.balance, transactionId: txRow.id, alreadyRefunded: false };
  };

  if (executor) return run(executor);

  try {
    return await db.transaction((tx) => run(tx));
  } catch (err) {
    // Race-safe recovery (23505): a concurrent refund with the same key won the INSERT.
    // The transaction is already rolled back, so recover with fresh (non-tx) queries.
    if (pgErrorCode(err) === '23505') {
      const [existingTx] = await db
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
      if (existingTx) {
        const [bal] = await db.select({ balance: wallets.balance }).from(wallets)
          .where(and(eq(wallets.userId, userId), eq(wallets.organizationId, organizationId)));
        return { success: true, newBalance: bal?.balance ?? 0, transactionId: existingTx.id, alreadyRefunded: true };
      }
    }
    throw err;
  }
}

/** Read current credit balance for a user within an organization (0 if no wallet). */
export async function getBalance(userId: string, organizationId: string): Promise<number> {
  const [row] = await db.select({ balance: wallets.balance }).from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.organizationId, organizationId)));
  return row?.balance ?? 0;
}

// spendCredits and refundCredits are TODO(Basher) — the spend path lives in
// queue/index.ts as part of the transactional request handler.
