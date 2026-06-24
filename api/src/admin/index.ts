// Owner: Basher (admin write paths)
import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { grantCredits } from '../credits/service.js';
import { getEventBySlug } from '../event/index.js';
import { advanceQueue } from '../queue/index.js';
import { sendError } from '../http/middleware.js';

// ── POST /api/admin/credits/grant ─────────────────────────────────────────────
// Grants credits to any user. Audited via credit_transactions (reason='admin_grant',
// actor_id = the admin's user ID). Idempotent on idempotencyKey.
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminGrantHandler(req: Request, res: Response) {
  const { targetUserId, amount, note, idempotencyKey } = req.body as {
    targetUserId?: string;
    amount?:       number;
    note?:         string;
    idempotencyKey?: string;
  };

  if (!targetUserId || amount == null || !idempotencyKey) {
    sendError(res, 400, 'validation', 'targetUserId, amount, and idempotencyKey are required');
    return;
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    sendError(res, 400, 'validation', 'amount must be a positive integer');
    return;
  }

  // Verify target user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
  if (!userCheck.rows[0]) {
    sendError(res, 404, 'not_found', `User '${targetUserId}' not found`);
    return;
  }

  const adminUserId = req.session.userId!;
  const reason      = note ? `admin_grant: ${note}` : 'admin_grant';

  // CreditsService.grantCredits handles the transaction + idempotency internally.
  // actor_id = admin user ID creates the audit trail (MC-08, MC-09).
  const result = await grantCredits(targetUserId, amount, reason, idempotencyKey, adminUserId);

  res.json({ balance: result.newBalance });
}

// ── POST /api/admin/events/:slug/advance ──────────────────────────────────────
// Advances the queue: current playing → played; next pending → playing;
// Play Next slot reset to available (no refund — D6 decision).
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminAdvanceHandler(req: Request, res: Response) {
  const { slug } = req.params;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }

  const userId   = req.session.userId!;
  const queueView = await advanceQueue(event.id, userId);

  res.json({ queueView });
}
