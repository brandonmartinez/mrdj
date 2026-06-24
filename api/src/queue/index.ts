// Owner: Rusty (queue reads) | Basher (write paths)
import type { Request, Response } from 'express';
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import {
  db, pgErrorCode,
  queueItems, tracks, playNextSlot, pricingConfig, wallets, creditTransactions,
} from '../db/index.js';
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

// Column projection for the queue-item ⋈ track join. Keys are snake_case to match
// rowToQueueItem's accessors (and the frozen slice-01 wire contract).
const QUEUE_ITEM_COLS = {
  id:           queueItems.id,
  status:       queueItems.status,
  position:     queueItems.position,
  is_play_next: queueItems.isPlayNext,
  requester_id: queueItems.requesterId,
  track_id:     tracks.id,
  provider:     tracks.provider,
  provider_id:  tracks.providerId,
  title:        tracks.title,
  artist:       tracks.artist,
  album:        tracks.album,
  artwork_url:  tracks.artworkUrl,
  duration_ms:  tracks.durationMs,
};

/** Fetch a single queue item joined to its track, or undefined. */
async function fetchQueueItem(id: string) {
  const rows = await db
    .select(QUEUE_ITEM_COLS)
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .where(eq(queueItems.id, id));
  return rows[0];
}

/** Read a user's current credit balance (0 if no wallet row). */
async function fetchBalance(userId: string): Promise<number> {
  const [row] = await db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId));
  return row?.balance ?? 0;
}

// ── buildQueueView — shared helper ───────────────────────────────────────────
// Used by getQueueHandler, createRequestHandler, advanceQueue, removeQueueItem,
// and reorderQueueItem. Always reads via the pool (callers invoke it AFTER their
// own transaction has committed), so it takes no executor.

export async function buildQueueView(eventId: string, userId: string): Promise<QueueView> {
  const [nowRows, prevRows, upcomingRows, pnsRows, pricingRows, walletRows] = await Promise.all([
    db.select(QUEUE_ITEM_COLS).from(queueItems).innerJoin(tracks, eq(tracks.id, queueItems.trackId))
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'playing'))).limit(1),
    db.select(QUEUE_ITEM_COLS).from(queueItems).innerJoin(tracks, eq(tracks.id, queueItems.trackId))
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'played')))
      .orderBy(desc(queueItems.updatedAt)).limit(20),
    db.select(QUEUE_ITEM_COLS).from(queueItems).innerJoin(tracks, eq(tracks.id, queueItems.trackId))
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'pending')))
      .orderBy(asc(queueItems.position)),
    db.select({ status: playNextSlot.status, holderQueueItemId: playNextSlot.holderQueueItemId })
      .from(playNextSlot).where(eq(playNextSlot.eventId, eventId)),
    db.select({ key: pricingConfig.key, value: pricingConfig.value })
      .from(pricingConfig).where(inArray(pricingConfig.key, ['queue', 'boost', 'play_next'])),
    db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)),
  ]);

  const pricing: QueueView['pricing'] = { queue: 0, boost: 1, playNext: 3 };
  for (const row of pricingRows) {
    if (row.key === 'queue')     pricing.queue    = row.value;
    if (row.key === 'boost')     pricing.boost    = row.value;
    if (row.key === 'play_next') pricing.playNext = row.value;
  }

  const pns = pnsRows[0];
  return {
    nowPlaying: nowRows[0] ? rowToQueueItem(nowRows[0]) : null,
    previous:   prevRows.map(rowToQueueItem),
    upcoming:   upcomingRows.map(rowToQueueItem),
    playNext: {
      status:            (pns?.status ?? 'available') as PlayNextState['status'],
      holderQueueItemId: pns?.holderQueueItemId ?? null,
      price:             pricing.playNext,
    },
    pricing,
    creditBalance: walletRows[0]?.balance ?? 0,
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
 *  - Failed actions never debit: the transaction returns a typed failure (committing nothing,
 *    since all checks run before any write) or throws to roll back.
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
  const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, trackId));
  if (!track) {
    sendError(res, 400, 'validation', `Track '${trackId}' not found`);
    return;
  }

  // Hoisted so the 23514 (concurrent-spend) catch can report the right cost on a 402.
  let cost = 0;
  try {
    const result = await db.transaction(async (tx) => {
      // ── Server-authoritative pricing (never trust request body) ───────────
      const pricingRows = await tx
        .select({ key: pricingConfig.key, value: pricingConfig.value })
        .from(pricingConfig)
        .where(inArray(pricingConfig.key, ['queue', 'boost', 'play_next']));
      const pricing = { queue: 0, boost: 1, playNext: 3 };
      for (const r of pricingRows) {
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
        await tx.select({ status: playNextSlot.status })
          .from(playNextSlot).where(eq(playNextSlot.eventId, event.id)).for('update');
      }

      // ── Idempotency: same key → return original result, no second charge ──
      const [existingTx] = await tx
        .select({ id: creditTransactions.id, referenceId: creditTransactions.referenceId })
        .from(creditTransactions)
        .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
      if (existingTx) {
        // No writes happened; committing the (empty) tx releases any FOR UPDATE lock.
        return { kind: 'idempotent' as const, queueItemId: existingTx.referenceId as string };
      }

      // ── Play Next: verify slot is available (lock already held) ───────────
      if (tier === 'play_next') {
        const [slot] = await tx.select({ status: playNextSlot.status })
          .from(playNextSlot).where(eq(playNextSlot.eventId, event.id));
        if (!slot || slot.status !== 'available') {
          return { kind: 'play_next_unavailable' as const };
        }
      }

      // ── Balance check (paid tiers) ────────────────────────────────────────
      if (cost > 0) {
        const [w] = await tx.select({ balance: wallets.balance })
          .from(wallets).where(eq(wallets.userId, userId));
        const bal = w?.balance ?? 0;
        if (bal < cost) {
          return { kind: 'insufficient' as const, cost, balance: bal };
        }
      }

      // ── Determine queue position and shift existing items ─────────────────
      let insertPosition: number;
      let isPlayNext = false;

      if (tier === 'play_next') {
        // Shift all pending items down to free position 1
        await tx.update(queueItems)
          .set({ position: sql`${queueItems.position} + 1` })
          .where(and(eq(queueItems.eventId, event.id), eq(queueItems.status, 'pending')));
        insertPosition = 1;
        isPlayNext     = true;

      } else if (tier === 'boost') {
        // Boost target: position 2 if play_next is locked (so we can't jump the holder),
        // position 1 otherwise (front of the normal queue).
        const [slot] = await tx.select({ status: playNextSlot.status })
          .from(playNextSlot).where(eq(playNextSlot.eventId, event.id));
        const playNextLocked = slot?.status === 'locked';
        insertPosition = playNextLocked ? 2 : 1;

        await tx.update(queueItems)
          .set({ position: sql`${queueItems.position} + 1` })
          .where(and(
            eq(queueItems.eventId, event.id),
            eq(queueItems.status, 'pending'),
            gte(queueItems.position, insertPosition),
          ));

      } else {
        // queue (free): append after all current pending items
        const [maxRow] = await tx
          .select({ maxPos: sql<number>`COALESCE(MAX(${queueItems.position}), 0)` })
          .from(queueItems)
          .where(and(eq(queueItems.eventId, event.id), eq(queueItems.status, 'pending')));
        insertPosition = (maxRow?.maxPos ?? 0) + 1;
      }

      // ── Insert queue item ─────────────────────────────────────────────────
      const [inserted] = await tx.insert(queueItems)
        .values({
          eventId:     event.id,
          trackId,
          requesterId: userId,
          position:    insertPosition,
          status:      'pending',
          isPlayNext,
        })
        .returning({ id: queueItems.id });
      const queueItemId = inserted.id;

      // ── Record credit transaction (always — even for free tier) ───────────
      // Storing even 0-cost actions ensures consistent idempotency via the UNIQUE key.
      // reference_id links back to the queue_item for retry reconstruction.
      await tx.insert(creditTransactions).values({
        userId,
        type:        'spend',
        amount:      cost,
        reason:      tier,
        idempotencyKey,
        referenceId: queueItemId,
      });

      // ── Debit wallet (paid tiers only) ────────────────────────────────────
      if (cost > 0) {
        await tx.update(wallets)
          .set({ balance: sql`${wallets.balance} - ${cost}`, updatedAt: sql`now()` })
          .where(eq(wallets.userId, userId));
      }

      // ── Lock play_next slot ───────────────────────────────────────────────
      if (tier === 'play_next') {
        await tx.update(playNextSlot)
          .set({ status: 'locked', holderQueueItemId: queueItemId, lockedAt: sql`now()` })
          .where(eq(playNextSlot.eventId, event.id));
      }

      return { kind: 'created' as const, queueItemId };
    });

    // ── Translate the transaction outcome into an HTTP response ─────────────
    if (result.kind === 'idempotent') {
      const [queueItem, queueView, creditBalance] = await Promise.all([
        fetchQueueItem(result.queueItemId),
        buildQueueView(event.id, userId),
        fetchBalance(userId),
      ]);
      res.json({
        queueItem:     queueItem ? rowToQueueItem(queueItem) : null,
        creditBalance,
        queueView,
      });
      return;
    }

    if (result.kind === 'play_next_unavailable') {
      sendError(res, 409, 'play_next_unavailable', 'The Play Next slot is not available');
      return;
    }

    if (result.kind === 'insufficient') {
      sendError(res, 402, 'insufficient_credits', 'Insufficient credits', {
        required: result.cost,
        balance:  result.balance,
      });
      return;
    }

    // result.kind === 'created'
    publishQueueChanged(event.id);
    const [queueItemFull, queueView, creditBalance] = await Promise.all([
      fetchQueueItem(result.queueItemId),
      buildQueueView(event.id, userId),
      fetchBalance(userId),
    ]);
    res.status(201).json({
      queueItem:     rowToQueueItem(queueItemFull!),
      creditBalance,
      queueView,
    });
  } catch (err) {
    // Race-safe idempotency recovery (Postgres 23505 = unique_violation):
    // Two concurrent requests with the same idempotency key can both pass the
    // SELECT idempotency check before either commits, then race on the INSERT.
    // Only play_next is serialised by FOR UPDATE; boost/queue have no row lock.
    // When the loser gets 23505, recover gracefully by returning the prior result
    // rather than propagating a 500.  No double-charge ever occurs (the UNIQUE
    // constraint guarantees exactly one ledger row).
    if (pgErrorCode(err) === '23505' && idempotencyKey) {
      try {
        const [existingTx] = await db
          .select({ id: creditTransactions.id, referenceId: creditTransactions.referenceId })
          .from(creditTransactions)
          .where(eq(creditTransactions.idempotencyKey, idempotencyKey));
        if (existingTx) {
          const [queueItem, queueView, creditBalance] = await Promise.all([
            fetchQueueItem(existingTx.referenceId as string),
            buildQueueView(event.id, userId),
            fetchBalance(userId),
          ]);
          res.status(200).json({
            queueItem:     queueItem ? rowToQueueItem(queueItem) : null,
            creditBalance,
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
    if (pgErrorCode(err) === '23514') {
      try {
        const balance = await fetchBalance(userId);
        sendError(res, 402, 'insufficient_credits', 'Insufficient credits', {
          required: cost,
          balance,
        });
        return;
      } catch {
        // Fall through and re-throw the original error.
      }
    }

    throw err;
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
  await db.transaction(async (tx) => {
    // Mark current now-playing as played
    await tx.update(queueItems)
      .set({ status: 'played', updatedAt: sql`now()` })
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'playing')));

    // Promote the next pending item (play_next holder is at position 1, otherwise min position).
    // FOR UPDATE so a concurrent removeQueueItem — which locks the row, rejects it, and refunds
    // inside its own txn — cannot be promoted here. If remove commits first, EvalPlanQual re-checks
    // the qual against the new row version (now status='rejected'), excludes it, and locks the next
    // still-pending row instead. The status guard on the UPDATE is belt-and-suspenders. Without this
    // an advance||remove race (e.g. the auto-advance timer vs an admin remove) could set a
    // just-refunded item to 'playing' — refunding the guest AND still playing their song.
    const [next] = await tx
      .select({ id: queueItems.id })
      .from(queueItems)
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'pending')))
      .orderBy(asc(queueItems.position))
      .limit(1)
      .for('update');

    if (next) {
      await tx.update(queueItems)
        .set({ status: 'playing', isPlayNext: false, position: 0, updatedAt: sql`now()` })
        .where(and(eq(queueItems.id, next.id), eq(queueItems.status, 'pending')));
    }

    // Reset Play Next slot — no refund (D6 decision)
    await tx.update(playNextSlot)
      .set({ status: 'available', holderQueueItemId: null, resetAt: sql`now()` })
      .where(eq(playNextSlot.eventId, eventId));
  });

  publishQueueChanged(eventId);
  return buildQueueView(eventId, userId);
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
  const refund = await db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id:          queueItems.id,
        status:      queueItems.status,
        isPlayNext:  queueItems.isPlayNext,
        requesterId: queueItems.requesterId,
      })
      .from(queueItems)
      .where(and(eq(queueItems.id, queueItemId), eq(queueItems.eventId, eventId)))
      .for('update');

    if (!item) {
      throw new QueueError('not_found', 'Queue item not found', 404);
    }
    if (item.status !== 'pending') {
      throw new QueueError('validation', 'Only a pending (not-yet-played) item can be removed', 409);
    }

    // Look up the original paid spend (if any) before mutating.
    const [spend] = await tx
      .select({ amount: creditTransactions.amount })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.referenceId, queueItemId),
        eq(creditTransactions.type, 'spend'),
        gt(creditTransactions.amount, 0),
      ))
      .orderBy(asc(creditTransactions.createdAt))
      .limit(1);
    const spendAmount = spend?.amount ?? 0;

    // Mark rejected and pull it out of the ordering.
    await tx.update(queueItems)
      .set({ status: 'rejected', isPlayNext: false, position: 0, updatedAt: sql`now()` })
      .where(eq(queueItems.id, queueItemId));

    // Recompact remaining pending positions (Play Next holder pinned first).
    await tx.execute(sql`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY is_play_next DESC, position ASC) AS rn
        FROM queue_items WHERE event_id = ${eventId} AND status = 'pending'
      )
      UPDATE queue_items qi SET position = o.rn FROM ordered o WHERE qi.id = o.id
    `);

    // If it held the Play Next slot, free it.
    if (item.isPlayNext) {
      await tx.update(playNextSlot)
        .set({ status: 'available', holderQueueItemId: null, resetAt: sql`now()` })
        .where(eq(playNextSlot.eventId, eventId));
    }

    // O7 auto-refund (only for paid, unplayed items). Enlists in this transaction so the
    // refund ledger row + wallet credit are atomic with the rejection.
    if (spendAmount > 0) {
      await refundCredits(
        item.requesterId,
        spendAmount,
        'refund',
        `refund-${queueItemId}`,
        queueItemId,
        adminUserId,
        tx,
      );
      return { userId: item.requesterId, amount: spendAmount };
    }
    return null;
  });

  publishQueueChanged(eventId);
  const queueView = await buildQueueView(eventId, adminUserId);
  return { queueView, refund };
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

  const outcome = await db.transaction(async (tx) => {
    const items = await tx
      .select({ id: queueItems.id, position: queueItems.position, isPlayNext: queueItems.isPlayNext })
      .from(queueItems)
      .where(and(eq(queueItems.eventId, eventId), eq(queueItems.status, 'pending')))
      .orderBy(asc(queueItems.position))
      .for('update');

    const idx = items.findIndex((r) => r.id === queueItemId);
    if (idx === -1) {
      throw new QueueError('not_found', 'Pending queue item not found', 404);
    }

    const target = items[idx];
    if (target.isPlayNext) {
      throw new QueueError('validation', 'The Play Next holder is pinned and cannot be reordered', 409);
    }

    const neighborIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= items.length) {
      return 'noop' as const; // already at the edge — no-op (nothing written)
    }

    const neighbor = items[neighborIdx];
    if (neighbor.isPlayNext) {
      throw new QueueError('validation', 'Cannot move above the Play Next holder', 409);
    }

    await tx.update(queueItems)
      .set({ position: neighbor.position, updatedAt: sql`now()` })
      .where(eq(queueItems.id, target.id));
    await tx.update(queueItems)
      .set({ position: target.position, updatedAt: sql`now()` })
      .where(eq(queueItems.id, neighbor.id));

    return 'swapped' as const;
  });

  if (outcome === 'swapped') publishQueueChanged(eventId);
  return buildQueueView(eventId, adminUserId);
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
  // These read-only aggregates (FILTER, EXISTS, window-free GROUP BY) are clearest as raw SQL.
  // They run through the Drizzle executor (db.execute), so there are no remaining pool.query calls.
  const [counts, spend, refunded, playNext, pnPurchased, topRequesters] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE qi.status <> 'rejected') AS request_count,
        COUNT(*) FILTER (
          WHERE qi.status <> 'rejected' AND EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.reference_id = qi.id AND ct.type = 'spend' AND ct.amount > 0
          )
        ) AS paid_request_count
      FROM queue_items qi WHERE qi.event_id = ${eventId}`),
    db.execute(sql`
      SELECT COALESCE(SUM(ct.amount), 0) AS spent
      FROM credit_transactions ct
      JOIN queue_items qi ON qi.id = ct.reference_id
      WHERE qi.event_id = ${eventId} AND ct.type = 'spend' AND ct.amount > 0`),
    db.execute(sql`
      SELECT COALESCE(SUM(ct.amount), 0) AS refunded
      FROM credit_transactions ct
      JOIN queue_items qi ON qi.id = ct.reference_id
      WHERE qi.event_id = ${eventId} AND ct.type = 'refund'`),
    db.execute(sql`SELECT status FROM play_next_slot WHERE event_id = ${eventId}`),
    db.execute(sql`
      SELECT COUNT(*) AS purchased
      FROM credit_transactions ct
      JOIN queue_items qi ON qi.id = ct.reference_id
      WHERE qi.event_id = ${eventId} AND ct.reason = 'play_next' AND ct.type = 'spend'`),
    db.execute(sql`
      SELECT qi.requester_id AS user_id,
             COALESCE(a.display_name, 'Guest') AS display_name,
             COUNT(DISTINCT qi.id) FILTER (WHERE qi.status <> 'rejected') AS requests,
             COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'spend' AND ct.amount > 0), 0) AS spent
      FROM queue_items qi
      LEFT JOIN accounts a ON a.user_id = qi.requester_id
      LEFT JOIN credit_transactions ct ON ct.reference_id = qi.id
      WHERE qi.event_id = ${eventId}
      GROUP BY qi.requester_id, a.display_name
      ORDER BY requests DESC, spent DESC
      LIMIT 5`),
  ]);

  const countsRow = counts.rows[0] as Record<string, unknown> | undefined;
  return {
    requestCount:     Number(countsRow?.request_count ?? 0),
    paidRequestCount: Number(countsRow?.paid_request_count ?? 0),
    creditsSpent:     Number((spend.rows[0]    as Record<string, unknown> | undefined)?.spent    ?? 0),
    creditsRefunded:  Number((refunded.rows[0] as Record<string, unknown> | undefined)?.refunded ?? 0),
    playNext: {
      status:         String((playNext.rows[0]    as Record<string, unknown> | undefined)?.status    ?? 'available'),
      purchasedCount: Number((pnPurchased.rows[0] as Record<string, unknown> | undefined)?.purchased ?? 0),
    },
    topRequesters: (topRequesters.rows as Record<string, unknown>[]).map((r) => ({
      userId:      r.user_id as string,
      displayName: r.display_name as string,
      requests:    Number(r.requests ?? 0),
      spent:       Number(r.spent ?? 0),
    })),
  };
}
