// Owner: Rusty (middleware)
import type { Request, Response, NextFunction } from 'express';

// Seeded guest user (stable ID matching seed.ts)
export const SEED_IDS = {
  guestUser:   '00000000-0000-0000-0000-000000000003',
  adminUser:   '00000000-0000-0000-0000-000000000001',
  demoEventId: '00000000-0000-0000-0000-000000000010',
} as const;

/** Auto-init session to seeded guest when no session exists (dev convenience). */
export function initSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.userId) {
    req.session.userId      = SEED_IDS.guestUser;
    req.session.role        = 'guest';
    req.session.type        = 'guest';
    req.session.displayName = 'Guest User';
  }
  next();
}

/** Guard: require admin role. Returns 403 if not admin. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.role !== 'admin') {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Admin role required' },
    });
    return;
  }
  next();
}

/** Standard error shape used across all routes. */
export type ApiError =
  | 'insufficient_credits'
  | 'play_next_unavailable'
  | 'forbidden'
  | 'not_found'
  | 'validation';

export function sendError(
  res: Response,
  status: number,
  code: ApiError,
  message: string,
  extra?: Record<string, unknown>,
) {
  res.status(status).json({ error: { code, message, ...extra } });
}
