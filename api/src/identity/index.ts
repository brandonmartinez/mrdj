// Owner: Rusty (identity reads + dev role switcher)
import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { SEED_IDS, sendError } from '../http/middleware.js';

export async function meHandler(req: Request, res: Response) {
  const userId = req.session.userId!;

  // Credit balance (reads wallet; falls back to 0 if not found)
  const walletRow = await pool.query(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [userId],
  );
  const creditBalance: number = walletRow.rows[0]?.balance ?? 0;

  // Fetch demo event (always the demo event for this slice)
  const eventRow = await pool.query(
    `SELECT id, slug, name FROM events WHERE slug = 'demo' LIMIT 1`,
  );
  if (!eventRow.rows[0]) {
    sendError(res, 404, 'not_found', 'Demo event not found — did migrations + seed run?');
    return;
  }
  const event = eventRow.rows[0];

  res.json({
    user: {
      id:          userId,
      type:        req.session.type,
      role:        req.session.role,
      displayName: req.session.displayName,
    },
    event: {
      id:   event.id,
      slug: event.slug,
      name: event.name,
    },
    creditBalance,
  });
}

export function actAsHandler(req: Request, res: Response) {
  const { role } = req.body as { role?: string };

  if (role !== 'guest' && role !== 'admin') {
    sendError(res, 400, 'validation', 'role must be "guest" or "admin"');
    return;
  }

  if (role === 'admin') {
    req.session.userId      = SEED_IDS.adminUser;
    req.session.role        = 'admin';
    req.session.type        = 'account';
    req.session.displayName = 'Admin DJ';
  } else {
    req.session.userId      = SEED_IDS.guestUser;
    req.session.role        = 'guest';
    req.session.type        = 'guest';
    req.session.displayName = 'Guest User';
  }

  res.json({ ok: true, role });
}
