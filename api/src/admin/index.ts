// Owner: Basher (admin write paths)
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, users } from '../db/index.js';
import { grantCredits } from '../credits/service.js';
import { getDefaultOrgId, getMembershipForUser, roleSatisfies } from '../org/index.js';
import { getEventBySlug } from '../event/index.js';
import {
  advanceQueue,
  removeQueueItem,
  reorderQueueItem,
  getEventStats,
  QueueError,
} from '../queue/index.js';
import { publishAll } from '../realtime/index.js';
import { sendError } from '../http/middleware.js';

async function requireConsoleDj(req: Request, res: Response, event: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) {
    sendError(res, 403, 'forbidden', 'Authentication required');
    return false;
  }
  const membership = await getMembershipForUser(event.organization_id, userId);
  if (!membership || !roleSatisfies(membership.role, 'dj')) {
    sendError(res, 403, 'forbidden', 'Requires DJ or manager role in this event organization');
    return false;
  }
  return true;
}

function bodyAreaId(req: Request): string | undefined {
  return typeof req.body?.areaId === 'string' ? req.body.areaId : undefined;
}

function queryAreaId(req: Request): string | undefined {
  return typeof req.query.areaId === 'string' ? req.query.areaId : undefined;
}

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
  const [userCheck] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId));
  if (!userCheck) {
    sendError(res, 404, 'not_found', `User '${targetUserId}' not found`);
    return;
  }

  const adminUserId = req.session.userId!;
  const reason      = note ? `admin_grant: ${note}` : 'admin_grant';

  const organizationId = await getDefaultOrgId();
  if (!organizationId) {
    sendError(res, 500, 'internal', 'No organization configured');
    return;
  }

  // CreditsService.grantCredits handles the transaction + idempotency internally.
  // actor_id = admin user ID creates the audit trail (MC-08, MC-09).
  const result = await grantCredits(targetUserId, organizationId, amount, reason, idempotencyKey, adminUserId);

  // The grant changes the target's balance (shown in their queue view) — signal all
  // streams so the affected guest re-fetches their own per-user view immediately.
  publishAll();

  res.json({ balance: result.newBalance });
}

// ── POST /api/admin/events/:slug/reorder ──────────────────────────────────────
// Nudge a pending item up/down. The Play Next holder is pinned (see reorderQueueItem).
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminReorderHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const { queueItemId, direction } = req.body as {
    queueItemId?: string;
    direction?:   'up' | 'down';
  };

  if (!queueItemId || (direction !== 'up' && direction !== 'down')) {
    sendError(res, 400, 'validation', "queueItemId and direction ('up'|'down') are required");
    return;
  }

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }
  if (!(await requireConsoleDj(req, res, event))) return;

  try {
    const queueView = await reorderQueueItem(event.id, queueItemId, direction, req.session.userId!, bodyAreaId(req));
    res.json({ queueView });
  } catch (err) {
    if (err instanceof QueueError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

// ── POST /api/admin/events/:slug/remove ───────────────────────────────────────
// Remove/reject a pending item. O7 auto-refund for paid items; frees Play Next slot if held.
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminRemoveHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const { queueItemId } = req.body as { queueItemId?: string };

  if (!queueItemId) {
    sendError(res, 400, 'validation', 'queueItemId is required');
    return;
  }

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }
  if (!(await requireConsoleDj(req, res, event))) return;

  try {
    const { queueView, refund } = await removeQueueItem(event.id, event.organization_id, queueItemId, req.session.userId!, bodyAreaId(req));
    res.json({ queueView, refund });
  } catch (err) {
    if (err instanceof QueueError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

// ── GET /api/admin/events/:slug/stats ─────────────────────────────────────────
// Simple aggregates for the DJ console (request counts, credits spent/refunded, top requesters).
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminStatsHandler(req: Request, res: Response) {
  const { slug } = req.params;

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }
  if (!(await requireConsoleDj(req, res, event))) return;

  const stats = await getEventStats(event.id, queryAreaId(req));
  res.json({ stats });
}

// ── POST /api/admin/events/:slug/advance ──────────────────────────────────────
// Advances the queue: current playing → played; next pending → playing;
// Play Next slot reset to available (no refund — D6 decision).
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export async function adminAdvanceHandler(req: Request, res: Response) {
  const { slug } = req.params;
  const areaId = bodyAreaId(req);

  const event = await getEventBySlug(slug);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${slug}' not found`);
    return;
  }
  if (!(await requireConsoleDj(req, res, event))) return;

  const userId   = req.session.userId!;
  try {
    const queueView = await advanceQueue(event.id, userId, areaId);
    res.json({ queueView });
  } catch (err) {
    if (err instanceof QueueError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}
