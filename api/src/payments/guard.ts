// Owner: Frank — charges_enabled guard (Epic 4, #26, O14).
// Blocks paid actions until the org's Stripe connected account has completed KYC
// (charges_enabled = true). Reusable across any paid-action route; returns HTTP 402
// with a clear, guest-facing message when onboarding is incomplete.
import type { RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { db, organizations } from '../db/index.js';
import { sendError } from '../http/middleware.js';

/**
 * Require the request's org (`req.orgContext`, set by resolveOrg) to have
 * `charges_enabled = true`. Must run after resolveOrg. When KYC is incomplete the
 * request is rejected with 402 Payment Required and an actionable message.
 */
export function requireChargesEnabled(): RequestHandler {
  return async (req, res, next) => {
    const org = req.orgContext;
    if (!org) {
      sendError(res, 500, 'internal', 'resolveOrg must run before requireChargesEnabled');
      return;
    }
    const [row] = await db
      .select({ chargesEnabled: organizations.chargesEnabled })
      .from(organizations)
      .where(eq(organizations.id, org.id));
    if (!row?.chargesEnabled) {
      res.status(402).json({
        error: {
          code:    'payments_unavailable',
          message: 'This organizer has not finished setting up payments yet. Please try again later.',
        },
      });
      return;
    }
    next();
  };
}
