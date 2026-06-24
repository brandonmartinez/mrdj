// Owner: Rusty (queue reads) | Basher (write paths)
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { getEventBySlug } from '../event/index.js';
import { sendError } from '../http/middleware.js';
import type { ApiError } from '../http/middleware.js';
import { refundCredits } from '../credits/service.js';
import { publishQueueChanged } from '../realtime/index.js';

// Carries an HTTP status + error code out of the core queue functions so the
// admin handlers can translate failures into the right response envelope.
export class QueueError extends Error {
  constructor(public code: ApiError, message: string, public status: number) {
    super(message);
    this.name = 'QueueError';
  }
}

// ── Shared types (frozen contract — see docs/slice-01-contract.md) ────────────

export interface Track {
  id:         string;
  provider:   string;
  providerId: string;
  title:      string;
  artist:     string;
  album:      string;
  artworkUrl: string;
  durationMs: number;
}

export interface QueueItem {
  id:          string;
  status:      'played' | 'playing' | 'pending';
  position:    number;
  isPlayNext:  boolean;
  track:       Track;
  requesterId: string;
}

export interface PlayNextState {
  status:              'available' | 'locked' | 'cooldown';
  holderQueueItemId:   string | null;
  price:               number;
}

export interface QueueView {
  nowPlaying:    QueueItem | null;
  previous:      QueueItem[];
  upcoming:      QueueItem[];
  playNext:      PlayNextState;
  pricing:       { queue: number; boost: number; playNext: number };
  creditBalance: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToQueueItem(row: Record<string, unknown>): QueueItem {
  return {
    id:         row.id as string,
    status:     row.status as QueueItem['status'],
    position:   row.position as number,
    isPlayNext: row.is_play_next as boolean,
    requesterId:row.requester_id as string,
    track: {
      id:         row.track_id as string,
      provider:   row.provider as string,
      providerId: row.provider_id as string,
      title:      row.title as string,
      artist:     row.artist as string,
      album:      row.album as string,
      artworkUrl: row.artwork_url as string,
      durationMs: row.duration_ms as number,
    },
  };
}

const QUEUE_JOIN = `
  SELECT
    qi.id, qi.status, qi.position, qi.is_play_next, qi.requester_id,
    t.id         AS track_id,
    t.provider,
    t.provider_id,
    t.title,
    t.artist,
    t.album,
    t.artwork_url,
    t.duration_ms
  FROM queue_items qi
  JOIN tracks t ON t.id = qi.track_id
  WHERE qi.event_id = $1
`;

// ── buildQueueView — shared helper ───────────────────────────────────────────
// Used by getQueueHandler, createRequestHandler, and advanceQueue.
// Accepts an optional PoolClient for use inside a transaction; falls back to pool.

export async function buildQueueView(
  eventId: string,
  userId:  string,
  client?: PoolClient,
): Promise<QueueView> {
  const q = client ?? pool;

  const [nowRow, prevRows, upcomingRows, pnsRow, pricingRows, walletRow] = await Promise.all([
    q.query(`${QUEUE_JOIN} AND qi.status = 'playing' LIMIT 1`, [eventId]),
    q.query(`${QUEUE_JOIN} AND qi.status = 'played' ORDER BY qi.updated_at DESC LIMIT 20`, [eventId]),
    q.query(`${QUEUE_JOIN} AND qi.status = 'pending' ORDER BY qi.position ASC`, [eventId]),
    q.query(`SELECT status, holder_queue_item_id FROM play_next_slot WHERE event_id = $1`, [eventId]),
    q.query(`SELECT key, value FROM pricing_config WHERE key IN ('queue','boost','play_next')`),
    q.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]),
  ]);

  const pricing: QueueView['pricing'] = { queue: 0, boost: 1, playNext: 3 };
  for (const row of pricingRows.rows as { key: string; value: number }[]) {
    if (row.key === 'queue')     pricing.queue    = row.value;
    if (row.key === 'boost')     pricing.boost    = row.value;
    if (row.key === 'play_next') pricing.playNext = row.value;
  }

  const pns = pnsRow.rows[0];
  return {
    nowPlaying:    nowRow.rows[0] ? rowToQueueItem(nowRow.rows[0]) : null,
    previous:      prevRows.rows.map(rowToQueueItem),
    upcoming:      upcomingRows.rows.map(rowToQueueItem),
    playNext: {
      status:            pns?.status ?? 'available',
      holderQueueItemId: pns?.holder_queue_item_id ?? null,
      price:             pricing.playNext,
    },
    pricing,
    creditBalance: walletRow.rows[0]?.balance ?? 0,
  };
}

// ── GET /api/events/:slug/queue ───────────────────────────────────────────────

export async function getQueueHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const userId = req.session.userId!;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  const view = await buildQueueView(event.id, userId);
  res.json(view);
}

// ── POST /api/events/:slug/requests ──────────────────────────────────────────

export interface CreateRequestBody {
  trackId:        string;
  tier:           'queue' | 'boost' | 'play_next';
  idempotencyKey: string;
}

/**
 * Add a track to the queue, optionally paying credits for boost or play_next.
 *
 * Money invariants enforced here:
 *  - Server-authoritative pricing: costs are read from pricing_config, never the request body.
 *  - Single atomic transaction: debit + queue insert + play_next_slot update are all-or-nothing.
 *  - Idempotency: credit_transactions.idempotency_key UNIQUE prevents double-charge on retry.
 *  - Failed actions never debit: rollback on any validation or availability failure.
 *  - Play Next concurrency: SELECT … FOR UPDATE on play_next_slot serialises concurrent purchases;
 *    only one caller can hold the lock — a second gets play_next_unavailable.
 */
export async function createRequestHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const userId   = req.session.userId!;

  // ── Input validation ──────────────────────────────────────────────────────
  const body = req.body as Partial<CreateRequestBody>;
  const { trackId, tier, idempotencyKey } = body;

  if (!trackId || !tier || !idempotencyKey) {
    sendError(res, 400, 'validation', 'trackId, tier, and idempotencyKey are required');
    return;
  }
  if (!['queue', 'boost', 'play_next'].includes(tier)) {
    sendError(res, 400, 'validation', 'tier must be one of: queue, boost, play_next');
    return;
  }

  // ── Look up event ─────────────────────────────────────────────────────────
  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  // ── Verify track exists (before opening transaction) ─────────────────────
  const trackCheck = await pool.query('SELECT id FROM tracks WHERE id = $1', [trackId]);
  if (!trackCheck.rows[0]) {
    sendError(res, 400, 'validation', `Track '${trackId}' not found`);
    return;
  }

  const c = await pool.connect();
  // Hoisted so the catch block can report it on a 23514 (concurrent-spend) recovery.
  let cost = 0;
  try {
    await c.query('BEGIN');

    // ── Server-authoritative pricing (never trust request body) ───────────
    const pricingRows = await c.query(
      `SELECT key, value FROM pricing_config WHERE key IN ('queue','boost','play_next')`,
    );
    const pricing = { queue: 0, boost: 1, playNext: 3 };
    for (const r of pricingRows.rows as { key: string; value: number }[]) {
      if (r.key === 'queue')     pricing.queue    = r.value;
      if (r.key === 'boost')     pricing.boost    = r.value;
      if (r.key === 'play_next') pricing.playNext = r.value;
    }
    cost = tier === 'queue' ? pricing.queue
         : tier === 'boost' ? pricing.boost
         : pricing.playNext;

    // ── Acquire Play Next slot lock BEFORE idempotency check ─────────────
    // FOR UPDATE serialises concurrent play_next purchases; held until COMMIT/ROLLBACK.
    if (tier === 'play_next') {
      await c.query(
        `SELECT status FROM play_next_slot WHERE event_id = $1 FOR UPDATE`,
        [event.id],
      );
    }

    // ── Idempotency: same key → return original result, no second charge ──
    const existingTx = await c.query(
      `SELECT id, reference_id FROM credit_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existingTx.rows[0]) {
      await c.query('ROLLBACK'); // nothing to commit; releases any row locks
      const existingQueueItemId: string = existingTx.rows[0].reference_id;
      const [queueItem, queueView, walletRow] = await Promise.all([
        pool.query(
          `SELECT qi.id, qi.status, qi.position, qi.is_play_next, qi.requester_id,
                  t.id AS track_id, t.provider, t.provider_id, t.title, t.artist,
                  t.album, t.artwork_url, t.duration_ms
           FROM queue_items qi JOIN tracks t ON t.id = qi.track_id
           WHERE qi.id = $1`,
          [existingQueueItemId],
        ),
        buildQueueView(event.id, userId),
        pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]),
      ]);
      res.json({
        queueItem:     queueItem.rows[0] ? rowToQueueItem(queueItem.rows[0]) : null,
        creditBalance: walletRow.rows[0]?.balance ?? 0,
        queueView,
      });
      return;
    }

    // ── Play Next: verify slot is available (lock already held) ───────────
    if (tier === 'play_next') {
      const slotRow = await c.query(
        `SELECT status FROM play_next_slot WHERE event_id = $1`,
        [event.id],
      );
      if (!slotRow.rows[0] || slotRow.rows[0].status !== 'available') {
        await c.query('ROLLBACK');
        sendError(res, 409, 'play_next_unavailable', 'The Play Next slot is not available');
        return;
      }
    }

    // ── Balance check (paid tiers) ────────────────────────────────────────
    if (cost > 0) {
      const walletRow = await c.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [userId],
      );
      const balance: number = walletRow.rows[0]?.balance ?? 0;
      if (balance < cost) {
        await c.query('ROLLBACK');
        sendError(res, 402, 'insufficient_credits', 'Insufficient credits', {
          required: cost,
          balance,
        });
        return;
      }
    }

    // ── Determine queue position and shift existing items ─────────────────
    let insertPosition: number;
    let isPlayNext = false;

    if (tier === 'play_next') {
      // Shift all pending items down to free position 1
      await c.query(
        `UPDATE queue_items SET position = position + 1
         WHERE event_id = $1 AND status = 'pending'`,
        [event.id],
      );
      insertPosition = 1;
      isPlayNext     = true;

    } else if (tier === 'boost') {
      // Boost target: position 2 if play_next is locked (so we can't jump the holder),
      // position 1 otherwise (front of the normal queue).
      const slotRow = await c.query(
        `SELECT status FROM play_next_slot WHERE event_id = $1`,
        [event.id],
      );
      const playNextLocked = slotRow.rows[0]?.status === 'locked';
      insertPosition = playNextLocked ? 2 : 1;

      await c.query(
        `UPDATE queue_items SET position = position + 1
         WHERE event_id = $1 AND status = 'pending' AND position >= $2`,
        [event.id, insertPosition],
      );

    } else {
      // queue (free): append after all current pending items
      const maxRow = await c.query(
        `SELECT COALESCE(MAX(position), 0) AS max_pos
         FROM queue_items WHERE event_id = $1 AND status = 'pending'`,
        [event.id],
      );
      insertPosition = (maxRow.rows[0]?.max_pos as number ?? 0) + 1;
    }

    // ── Insert queue item ─────────────────────────────────────────────────
    const queueItemRow = await c.query(
      `INSERT INTO queue_items(event_id, track_id, requester_id, position, status, is_play_next)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [event.id, trackId, userId, insertPosition, isPlayNext],
    );
    const queueItemId: string = queueItemRow.rows[0].id;

    // ── Record credit transaction (always — even for free tier) ───────────
    // Storing even 0-cost actions ensures consistent idempotency via the UNIQUE key.
    // reference_id links back to the queue_item for retry reconstruction.
    await c.query(
      `INSERT INTO credit_transactions(user_id, type, amount, reason, idempotency_key, reference_id)
       VALUES ($1, 'spend', $2, $3, $4, $5)`,
      [userId, cost, tier, idempotencyKey, queueItemId],
    );

    // ── Debit wallet (paid tiers only) ────────────────────────────────────
    if (cost > 0) {
      await c.query(
        `UPDATE wallets SET balance = balance - $1, updated_at = now()
         WHERE user_id = $2`,
        [cost, userId],
      );
    }

    // ── Lock play_next slot ───────────────────────────────────────────────
    if (tier === 'play_next') {
      await c.query(
        `UPDATE play_next_slot
         SET status = 'locked', holder_queue_item_id = $1, locked_at = now()
         WHERE event_id = $2`,
        [queueItemId, event.id],
      );
    }

    await c.query('COMMIT');
    publishQueueChanged(event.id);

    // ── Build response (outside transaction — read-only) ──────────────────
    const [queueItemFull, queueView, walletRow] = await Promise.all([
      pool.query(
        `SELECT qi.id, qi.status, qi.position, qi.is_play_next, qi.requester_id,
                t.id AS track_id, t.provider, t.provider_id, t.title, t.artist,
                t.album, t.artwork_url, t.duration_ms
         FROM queue_items qi JOIN tracks t ON t.id = qi.track_id
         WHERE qi.id = $1`,
        [queueItemId],
      ),
      buildQueueView(event.id, userId),
      pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]),
    ]);

    res.status(201).json({
      queueItem:     rowToQueueItem(queueItemFull.rows[0]),
      creditBalance: walletRow.rows[0]?.balance ?? 0,
      queueView,
    });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});

    // Race-safe idempotency recovery (Postgres 23505 = unique_violation):
    // Two concurrent requests with the same idempotency key can both pass the
    // SELECT idempotency check before either commits, then race on the INSERT.
    // Only play_next is serialised by FOR UPDATE; boost/queue have no row lock.
    // When the loser gets 23505, recover gracefully by returning the prior result
    // rather than propagating a 500.  No double-charge ever occurs (the UNIQUE
    // constraint guarantees exactly one ledger row).
    if ((err as { code?: string }).code === '23505' && idempotencyKey) {
      try {
        const existingTx = await pool.query(
          `SELECT id, reference_id FROM credit_transactions WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (existingTx.rows[0]) {
          const existingQueueItemId: string = existingTx.rows[0].reference_id;
          const [queueItemRes, queueView, walletRow] = await Promise.all([
            pool.query(
              `SELECT qi.id, qi.status, qi.position, qi.is_play_next, qi.requester_id,
                      t.id AS track_id, t.provider, t.provider_id, t.title, t.artist,
                      t.album, t.artwork_url, t.duration_ms
               FROM queue_items qi JOIN tracks t ON t.id = qi.track_id
               WHERE qi.id = $1`,
              [existingQueueItemId],
            ),
            buildQueueView(event.id, userId),
            pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]),
          ]);
          res.status(200).json({
            queueItem:     queueItemRes.rows[0] ? rowToQueueItem(queueItemRes.rows[0]) : null,
            creditBalance: walletRow.rows[0]?.balance ?? 0,
            queueView,
          });
          return;
        }
      } catch {
        // Recovery query itself failed; fall through and re-throw the original error.
      }
    }

    // Concurrent-spend recovery (Postgres 23514 = check_violation on wallets.balance >= 0):
    // Two paid requests can both pass the balance check (each sees balance ≥ cost) before
    // either commits, then the second debit drives the wallet below zero and trips the CHECK.
    // That is a money condition (the user can't afford both), not a server fault — surface it
    // as 402 insufficient_credits, not a 500. No charge is applied (the transaction rolled back).
    if ((err as { code?: string }).code === '23514') {
      try {
        const walletRow = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
        sendError(res, 402, 'insufficient_credits', 'Insufficient credits', {
          required: cost,
          balance:  walletRow.rows[0]?.balance ?? 0,
        });
        return;
      } catch {
        // Fall through and re-throw the original error.
      }
    }

    throw err;
  } finally {
    c.release();
  }
}

// ── advanceQueue — core advance logic (admin endpoint + auto-advance timer) ──
/**
 * Advance the queue for an event:
 *  1. Mark current playing item as played.
 *  2. Promote the lowest-position pending item to playing.
 *  3. Reset the Play Next slot to available (no refund — D6 decision).
 *
 * Returns the updated QueueView.
 */
export async function advanceQueue(eventId: string, userId: string): Promise<QueueView> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // Mark current now-playing as played
    await c.query(
      `UPDATE queue_items SET status = 'played', updated_at = now()
       WHERE event_id = $1 AND status = 'playing'`,
      [eventId],
    );

    // Promote the next pending item (play_next holder is at position 1, otherwise min position).
    // FOR UPDATE so a concurrent removeQueueItem — which locks the row, rejects it, and refunds
    // inside its own txn — cannot be promoted here. If remove commits first, EvalPlanQual re-checks
    // the qual against the new row version (now status='rejected'), excludes it, and locks the next
    // still-pending row instead. The status guard on the UPDATE is belt-and-suspenders. Without this
    // an advance||remove race (e.g. the auto-advance timer vs an admin remove) could set a
    // just-refunded item to 'playing' — refunding the guest AND still playing their song.
    const nextRow = await c.query(
      `SELECT id FROM queue_items
       WHERE event_id = $1 AND status = 'pending'
       ORDER BY position ASC LIMIT 1
       FOR UPDATE`,
      [eventId],
    );

    if (nextRow.rows[0]) {
      await c.query(
        `UPDATE queue_items
         SET status = 'playing', is_play_next = false, position = 0, updated_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [nextRow.rows[0].id],
      );
    }

    // Reset Play Next slot — no refund (D6 decision)
    await c.query(
      `UPDATE play_next_slot
       SET status = 'available', holder_queue_item_id = NULL, reset_at = now()
       WHERE event_id = $1`,
      [eventId],
    );

    await c.query('COMMIT');
    publishQueueChanged(eventId);

    return buildQueueView(eventId, userId);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ── removeQueueItem — admin remove/reject with O7 auto-refund ─────────────────
export interface RemoveResult {
  queueView: QueueView;
  refund:    { userId: string; amount: number } | null;
}

/**
 * Remove (reject) a pending queue item on behalf of an admin.
 *  - Only pending (never-played) items can be removed.
 *  - O7 auto-refund: if the item carried a paid spend (boost / play_next), refund the exact
 *    amount to the requester. Append-only + idempotent (key `refund-<queueItemId>`); the
 *    status='pending' guard means a re-remove can't double-refund.
 *  - If the item held the Play Next slot, reset the slot to available.
 *  - Remaining pending positions are recompacted (holder stays first).
 */
export async function removeQueueItem(
  eventId:     string,
  queueItemId: string,
  adminUserId: string,
): Promise<RemoveResult> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const itemRow = await c.query(
      `SELECT id, status, is_play_next, requester_id
       FROM queue_items WHERE id = $1 AND event_id = $2 FOR UPDATE`,
      [queueItemId, eventId],
    );
    const item = itemRow.rows[0];
    if (!item) {
      await c.query('ROLLBACK');
      throw new QueueError('not_found', 'Queue item not found', 404);
    }
    if (item.status !== 'pending') {
      await c.query('ROLLBACK');
      throw new QueueError('validation', 'Only a pending (not-yet-played) item can be removed', 409);
    }

    // Look up the original paid spend (if any) before mutating.
    const spendRow = await c.query(
      `SELECT amount FROM credit_transactions
       WHERE reference_id = $1 AND type = 'spend' AND amount > 0
       ORDER BY created_at ASC LIMIT 1`,
      [queueItemId],
    );
    const spendAmount: number = spendRow.rows[0]?.amount ?? 0;

    // Mark rejected and pull it out of the ordering.
    await c.query(
      `UPDATE queue_items
       SET status = 'rejected', is_play_next = false, position = 0, updated_at = now()
       WHERE id = $1`,
      [queueItemId],
    );

    // Recompact remaining pending positions (Play Next holder pinned first).
    await c.query(
      `WITH ordered AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY is_play_next DESC, position ASC) AS rn
         FROM queue_items WHERE event_id = $1 AND status = 'pending'
       )
       UPDATE queue_items qi SET position = o.rn FROM ordered o WHERE qi.id = o.id`,
      [eventId],
    );

    // If it held the Play Next slot, free it.
    if (item.is_play_next) {
      await c.query(
        `UPDATE play_next_slot
         SET status = 'available', holder_queue_item_id = NULL, reset_at = now()
         WHERE event_id = $1`,
        [eventId],
      );
    }

    // O7 auto-refund (only for paid, unplayed items).
    let refund: { userId: string; amount: number } | null = null;
    if (spendAmount > 0) {
      await refundCredits(
        item.requester_id as string,
        spendAmount,
        'refund',
        `refund-${queueItemId}`,
        queueItemId,
        adminUserId,
        c,
      );
      refund = { userId: item.requester_id as string, amount: spendAmount };
    }

    await c.query('COMMIT');
    publishQueueChanged(eventId);

    const queueView = await buildQueueView(eventId, adminUserId);
    return { queueView, refund };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ── reorderQueueItem — admin nudge a pending item up/down ─────────────────────
/**
 * Swap a pending item with its immediate neighbour.
 *  - The Play Next holder is pinned at the top: it cannot be moved, and nothing can move above it.
 *  - Edge moves (already first/last) are no-ops that return the current view.
 *  - All pending items are locked FOR UPDATE so a concurrent guest bump can't interleave.
 */
export async function reorderQueueItem(
  eventId:     string,
  queueItemId: string,
  direction:   'up' | 'down',
  adminUserId: string,
): Promise<QueueView> {
  if (direction !== 'up' && direction !== 'down') {
    throw new QueueError('validation', "direction must be 'up' or 'down'", 400);
  }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const rows = await c.query(
      `SELECT id, position, is_play_next
       FROM queue_items
       WHERE event_id = $1 AND status = 'pending'
       ORDER BY position ASC
       FOR UPDATE`,
      [eventId],
    );
    const items = rows.rows as { id: string; position: number; is_play_next: boolean }[];
    const idx = items.findIndex((r) => r.id === queueItemId);
    if (idx === -1) {
      await c.query('ROLLBACK');
      throw new QueueError('not_found', 'Pending queue item not found', 404);
    }

    const target = items[idx];
    if (target.is_play_next) {
      await c.query('ROLLBACK');
      throw new QueueError('validation', 'The Play Next holder is pinned and cannot be reordered', 409);
    }

    const neighborIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= items.length) {
      await c.query('ROLLBACK'); // already at the edge — no-op
      return buildQueueView(eventId, adminUserId);
    }

    const neighbor = items[neighborIdx];
    if (neighbor.is_play_next) {
      await c.query('ROLLBACK');
      throw new QueueError('validation', 'Cannot move above the Play Next holder', 409);
    }

    await c.query(
      `UPDATE queue_items SET position = $1, updated_at = now() WHERE id = $2`,
      [neighbor.position, target.id],
    );
    await c.query(
      `UPDATE queue_items SET position = $1, updated_at = now() WHERE id = $2`,
      [target.position, neighbor.id],
    );

    await c.query('COMMIT');
    publishQueueChanged(eventId);

    return buildQueueView(eventId, adminUserId);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ── eventStats — simple aggregates for the DJ console ─────────────────────────
export interface EventStats {
  requestCount:     number;
  paidRequestCount: number;
  creditsSpent:     number;
  creditsRefunded:  number;
  playNext:         { status: string; purchasedCount: number };
  topRequesters:    { userId: string; displayName: string; requests: number; spent: number }[];
}

export async function getEventStats(eventId: string): Promise<EventStats> {
  const [counts, spend, refunded, playNext, pnPurchased, topRequesters] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE qi.status <> 'rejected') AS request_count,
         COUNT(*) FILTER (
           WHERE qi.status <> 'rejected' AND EXISTS (
             SELECT 1 FROM credit_transactions ct
             WHERE ct.reference_id = qi.id AND ct.type = 'spend' AND ct.amount > 0
           )
         ) AS paid_request_count
       FROM queue_items qi WHERE qi.event_id = $1`,
      [eventId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(ct.amount), 0) AS spent
       FROM credit_transactions ct
       JOIN queue_items qi ON qi.id = ct.reference_id
       WHERE qi.event_id = $1 AND ct.type = 'spend' AND ct.amount > 0`,
      [eventId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(ct.amount), 0) AS refunded
       FROM credit_transactions ct
       JOIN queue_items qi ON qi.id = ct.reference_id
       WHERE qi.event_id = $1 AND ct.type = 'refund'`,
      [eventId],
    ),
    pool.query(`SELECT status FROM play_next_slot WHERE event_id = $1`, [eventId]),
    pool.query(
      `SELECT COUNT(*) AS purchased
       FROM credit_transactions ct
       JOIN queue_items qi ON qi.id = ct.reference_id
       WHERE qi.event_id = $1 AND ct.reason = 'play_next' AND ct.type = 'spend'`,
      [eventId],
    ),
    pool.query(
      `SELECT qi.requester_id AS user_id,
              COALESCE(a.display_name, 'Guest') AS display_name,
              COUNT(DISTINCT qi.id) FILTER (WHERE qi.status <> 'rejected') AS requests,
              COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'spend' AND ct.amount > 0), 0) AS spent
       FROM queue_items qi
       LEFT JOIN accounts a ON a.user_id = qi.requester_id
       LEFT JOIN credit_transactions ct ON ct.reference_id = qi.id
       WHERE qi.event_id = $1
       GROUP BY qi.requester_id, a.display_name
       ORDER BY requests DESC, spent DESC
       LIMIT 5`,
      [eventId],
    ),
  ]);

  return {
    requestCount:     Number(counts.rows[0]?.request_count ?? 0),
    paidRequestCount: Number(counts.rows[0]?.paid_request_count ?? 0),
    creditsSpent:     Number(spend.rows[0]?.spent ?? 0),
    creditsRefunded:  Number(refunded.rows[0]?.refunded ?? 0),
    playNext: {
      status:         playNext.rows[0]?.status ?? 'available',
      purchasedCount: Number(pnPurchased.rows[0]?.purchased ?? 0),
    },
    topRequesters: (topRequesters.rows as Record<string, unknown>[]).map((r) => ({
      userId:      r.user_id as string,
      displayName: r.display_name as string,
      requests:    Number(r.requests ?? 0),
      spent:       Number(r.spent ?? 0),
    })),
  };
}
