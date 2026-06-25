// Owner: Rusty (middleware)
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, guestSessions, users } from '../db/index.js';
import {
  getOrgBySlug, getMembershipForUser, roleSatisfies,
  type OrgRole, type OrganizationRow, type MembershipRow,
} from '../org/index.js';

// Per-request tenant context, populated by resolveOrg / requireMembership.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orgContext?: OrganizationRow;
      membership?: MembershipRow;
    }
  }
}

// Seeded guest user (stable ID matching seed.ts)
export const SEED_IDS = {
  guestUser:   '00000000-0000-0000-0000-000000000003',
  adminUser:   '00000000-0000-0000-0000-000000000001',
  demoEventId: '00000000-0000-0000-0000-000000000010',
} as const;

async function getOrCreateGuestUser(sessionToken: string): Promise<string> {
  const [existing] = await db
    .select({ userId: guestSessions.userId })
    .from(guestSessions)
    .where(eq(guestSessions.sessionToken, sessionToken))
    .limit(1);
  if (existing) return existing.userId;

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ type: 'guest' }).returning({ id: users.id });
      await tx.insert(guestSessions).values({
        userId:       user.id,
        sessionToken,
        expiresAt:    sql`now() + interval '7 days'`,
      });
      return user.id;
    });
  } catch (err) {
    const [raced] = await db
      .select({ userId: guestSessions.userId })
      .from(guestSessions)
      .where(eq(guestSessions.sessionToken, sessionToken))
      .limit(1);
    if (raced) return raced.userId;
    throw err;
  }
}

/** Auto-init anonymous sessions to a per-browser guest identity. */
export async function initSession(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) {
      req.session.userId      = await getOrCreateGuestUser(req.sessionID);
      req.session.role        = 'guest';
      req.session.type        = 'guest';
      req.session.displayName = 'Guest User';
    }
    next();
  } catch (err) {
    next(err);
  }
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

/**
 * Guard: require the SaaS platform-operator role (#76).
 *
 * D7 keeps Platform Admin distinct from org roles. Until dedicated platform-admin
 * accounts exist (later epic), the seeded global `admin` session stands in for the
 * operator. Org membership is checked separately by requireMembership.
 */
export const requirePlatformAdmin = requireAdmin;

/**
 * Resolve `:orgSlug` to a tenant and attach it as `req.orgContext` (O12 path
 * routing, #69). 404s unknown orgs so isolation failures read as "not found"
 * rather than leaking existence. Mount before requireMembership.
 */
export function resolveOrg(): RequestHandler {
  return async (req, res, next) => {
    const slug = req.params.orgSlug;
    if (!slug) {
      sendError(res, 400, 'validation', 'Organization slug is required');
      return;
    }
    const org = await getOrgBySlug(slug);
    if (!org) {
      sendError(res, 404, 'not_found', `Organization '${slug}' not found`);
      return;
    }
    req.orgContext = org;
    next();
  };
}

/**
 * Guard: require the session account to hold at least `minRole` in `req.orgContext`
 * (O13 app-level tenant scoping, #69/#72). Must run after resolveOrg. A missing
 * membership is a 403 — being a member of another org grants nothing here.
 */
export function requireMembership(minRole: OrgRole = 'staff'): RequestHandler {
  return async (req, res, next) => {
    const org = req.orgContext;
    if (!org) {
      sendError(res, 500, 'internal', 'resolveOrg must run before requireMembership');
      return;
    }
    const userId = req.session.userId;
    if (!userId) {
      sendError(res, 403, 'forbidden', 'Authentication required');
      return;
    }
    const membership = await getMembershipForUser(org.id, userId);
    if (!membership || !roleSatisfies(membership.role, minRole)) {
      sendError(res, 403, 'forbidden', `Requires '${minRole}' role in organization '${org.slug}'`);
      return;
    }
    req.membership = membership;
    next();
  };
}

/** Standard error shape used across all routes. */
export type ApiError =
  | 'insufficient_credits'
  | 'play_next_unavailable'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'internal';

export function sendError(
  res: Response,
  status: number,
  code: ApiError,
  message: string,
  extra?: Record<string, unknown>,
) {
  res.status(status).json({ error: { code, message, ...extra } });
}

/**
 * Wrap an async route handler so a rejected promise is routed to Express' error
 * middleware instead of becoming an unhandled rejection. Express 4 does NOT catch
 * async throws on its own — without this, a transient DB error inside a handler
 * crashes the process (the slice-01 footgun). Pair with the terminal error
 * middleware registered in server.ts.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
