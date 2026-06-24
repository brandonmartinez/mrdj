// Owner: Rusty (queue reads) | Basher (write paths — see TODO comments)
import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { getEventBySlug } from '../event/index.js';
import { sendError } from '../http/middleware.js';

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

// ── GET /api/events/:slug/queue ───────────────────────────────────────────────

export async function getQueueHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const userId = req.session.userId!;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  // Three targeted queries (clear + PgBouncer-safe, no named prepared statements)
  const [nowRow, prevRows, upcomingRows, pnsRow, pricingRows, walletRow] = await Promise.all([
    pool.query(`${QUEUE_JOIN} AND qi.status = 'playing' LIMIT 1`, [event.id]),
    pool.query(`${QUEUE_JOIN} AND qi.status = 'played' ORDER BY qi.updated_at DESC LIMIT 20`, [event.id]),
    pool.query(`${QUEUE_JOIN} AND qi.status = 'pending' ORDER BY qi.position ASC`, [event.id]),
    pool.query(
      `SELECT status, holder_queue_item_id FROM play_next_slot WHERE event_id = $1`,
      [event.id],
    ),
    pool.query(`SELECT key, value FROM pricing_config WHERE key IN ('queue','boost','play_next')`),
    pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]),
  ]);

  const pricing: QueueView['pricing'] = { queue: 0, boost: 1, playNext: 3 };
  for (const row of pricingRows.rows as { key: string; value: number }[]) {
    if (row.key === 'queue')     pricing.queue     = row.value;
    if (row.key === 'boost')     pricing.boost     = row.value;
    if (row.key === 'play_next') pricing.playNext  = row.value;
  }

  const pns = pnsRow.rows[0];
  const playNext: PlayNextState = {
    status:            pns?.status ?? 'available',
    holderQueueItemId: pns?.holder_queue_item_id ?? null,
    price:             pricing.playNext,
  };

  const view: QueueView = {
    nowPlaying:    nowRow.rows[0] ? rowToQueueItem(nowRow.rows[0]) : null,
    previous:      prevRows.rows.map(rowToQueueItem),
    upcoming:      upcomingRows.rows.map(rowToQueueItem),
    playNext,
    pricing,
    creditBalance: walletRow.rows[0]?.balance ?? 0,
  };

  res.json(view);
}

// ── POST /api/events/:slug/requests ──────────────────────────────────────────
// TODO(Basher): implement — core money/state path
// Types for Basher's reference:
export interface CreateRequestBody {
  trackId:        string;
  tier:           'queue' | 'boost' | 'play_next';
  idempotencyKey: string;
}

export function createRequestStub(req: Request, res: Response) {
  // Basher: validate body, check wallet balance, run single DB transaction:
  //   BEGIN
  //     SELECT ... FOR UPDATE on play_next_slot (if tier=play_next)
  //     INSERT credit_transactions (idempotency_key UNIQUE prevents double-charge)
  //     UPDATE wallets SET balance = balance - price WHERE user_id = $userId
  //     INSERT queue_items
  //     UPDATE play_next_slot (if tier=play_next)
  //   COMMIT
  res.status(501).json({
    error: {
      code: 'validation',
      message: 'Not implemented — TODO(Basher): implement POST /events/:slug/requests',
    },
  });
}
