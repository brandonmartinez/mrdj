// Owner: Rusty (self-serve Organization handlers — Epic 6, #32/#35)
//
// These power the DJ-facing onboarding UI: an SSO-authenticated account creates
// its own Organization (becoming `owner`) and lists the orgs it belongs to. This
// is distinct from the platform-admin `POST /api/orgs` provisioning path — here
// the actor is the current session account, never an arbitrary `ownerAccountId`.
import type { Request, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import {
  db, organizations, memberships, accounts, pgErrorCode,
} from '../db/index.js';
import { sendError } from '../http/middleware.js';
import { seedOrgPricingDefaults } from '../payments/pricing.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Resolve the session's account row (null for guests / accountless users). */
async function getSessionAccount(req: Request): Promise<{ id: string } | null> {
  const userId = req.session.userId;
  if (!userId || req.session.type !== 'account') return null;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  return row ?? null;
}

/** GET /api/me/orgs — organizations the current account belongs to (+ role). */
export async function listMyOrgsHandler(req: Request, res: Response) {
  const account = await getSessionAccount(req);
  if (!account) {
    res.json({ organizations: [] });
    return;
  }
  const rows = await db
    .select({
      id:   organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.accountId, account.id))
    .orderBy(asc(organizations.createdAt));
  res.json({ organizations: rows });
}

/**
 * POST /api/me/orgs — self-serve tenant creation (#32).
 *
 * The current account becomes `owner` of a fresh Organization seeded with the
 * platform-default pricing + credit bundles (O9). Guests are rejected — an
 * account (Google SSO) is required to own a business.
 */
export async function createMyOrgHandler(req: Request, res: Response) {
  const account = await getSessionAccount(req);
  if (!account) {
    sendError(res, 403, 'forbidden', 'Sign in to create an organization');
    return;
  }
  const { slug, name } = req.body as { slug?: string; name?: string };
  if (!slug || !SLUG_RE.test(slug)) {
    sendError(res, 400, 'validation', 'slug must be 1–40 lowercase alphanumerics/hyphens');
    return;
  }
  if (!name || !name.trim()) {
    sendError(res, 400, 'validation', 'name is required');
    return;
  }

  try {
    const org = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({ slug, name: name.trim() })
        .returning({ id: organizations.id, slug: organizations.slug, name: organizations.name });

      await tx.insert(memberships).values({
        organizationId: created.id,
        accountId:      account.id,
        role:           'owner',
      });
      await seedOrgPricingDefaults(created.id, tx);
      return created;
    });
    res.status(201).json({ organization: { ...org, role: 'owner' as const } });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      sendError(res, 409, 'validation', `Organization slug '${slug}' is already taken`);
      return;
    }
    throw err;
  }
}
