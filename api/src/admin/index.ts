// Owner: Basher (admin write paths)
import type { Request, Response } from 'express';

// ── POST /api/admin/credits/grant ─────────────────────────────────────────────
// TODO(Basher): validate body, call CreditsService.grantCredits with idempotencyKey
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export function adminGrantStub(_req: Request, res: Response) {
  res.status(501).json({
    error: {
      code:    'validation',
      message: 'Not implemented — TODO(Basher): implement POST /admin/credits/grant',
    },
  });
}

// ── POST /api/admin/events/:slug/advance ──────────────────────────────────────
// TODO(Basher): mark current playing item as played, advance next pending to playing,
// reset play_next_slot to 'available' (no refund this slice per D6).
// Requires admin role (enforced in routes.ts via requireAdmin middleware).
export function adminAdvanceStub(_req: Request, res: Response) {
  res.status(501).json({
    error: {
      code:    'validation',
      message: 'Not implemented — TODO(Basher): implement POST /admin/events/:slug/advance',
    },
  });
}
