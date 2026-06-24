// Owner: Rusty (identity reads + dev role switcher)
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, wallets, events } from '../db/index.js';
import { SEED_IDS, sendError } from '../http/middleware.js';

export async function meHandler(req: Request, res: Response) {
  const userId = req.session.userId!;

  // Credit balance (reads wallet; falls back to 0 if not found)
  const [walletRow] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  const creditBalance: number = walletRow?.balance ?? 0;

  // Fetch demo event (always the demo event for this slice)
  const [event] = await db
    .select({ id: events.id, slug: events.slug, name: events.name })
    .from(events)
    .where(eq(events.slug, 'demo'))
    .limit(1);
  if (!event) {
    sendError(res, 404, 'not_found', 'Demo event not found — did migrations + seed run?');
    return;
  }

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
