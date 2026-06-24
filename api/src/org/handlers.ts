// Owner: Rusty (Organization, Membership + Platform-admin HTTP handlers — Epic 2)
import type { Request, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import {
  db, forOrg, organizations, memberships, accounts, events,
} from '../db/index.js';
import { ORG_ROLES, type OrgRole } from './index.js';
import { sendError } from '../http/middleware.js';
import { pgErrorCode } from '../db/index.js';
import { seedOrgPricingDefaults } from '../payments/pricing.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function isOrgRole(v: unknown): v is OrgRole {
  return typeof v === 'string' && (ORG_ROLES as readonly string[]).includes(v);
}

// ── Organization CRUD (#71) ───────────────────────────────────────────────────

/** POST /api/orgs — platform admin creates a tenant (+ optional owner membership). */
export async function createOrgHandler(req: Request, res: Response) {
  const { slug, name, ownerAccountId } = req.body as {
    slug?: string; name?: string; ownerAccountId?: string;
  };
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

      if (ownerAccountId) {
        await tx.insert(memberships).values({
          organizationId: created.id,
          accountId:      ownerAccountId,
          role:           'owner',
        });
      }
      // Seed platform-default pricing + credit bundles (O9, #43) — replayable.
      await seedOrgPricingDefaults(created.id, tx);
      return created;
    });
    res.status(201).json({ organization: org });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      sendError(res, 409, 'validation', `Organization slug '${slug}' already exists`);
      return;
    }
    if (pgErrorCode(err) === '23503') {
      sendError(res, 400, 'validation', 'ownerAccountId does not reference a known account');
      return;
    }
    throw err;
  }
}

/** GET /api/orgs/:orgSlug — any member reads their org. */
export function getOrgHandler(req: Request, res: Response) {
  res.json({ organization: req.orgContext });
}

/** PATCH /api/orgs/:orgSlug — manager+ renames the org. */
export async function updateOrgHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    sendError(res, 400, 'validation', 'name is required');
    return;
  }
  const [updated] = await db
    .update(organizations)
    .set({ name: name.trim() })
    .where(eq(organizations.id, org.id))
    .returning({ id: organizations.id, slug: organizations.slug, name: organizations.name });
  res.json({ organization: updated });
}

// ── Platform admin read API (#76) ─────────────────────────────────────────────

/** GET /api/admin/platform/orgs — operator overview: every tenant + counts. */
export async function listPlatformOrgsHandler(_req: Request, res: Response) {
  const rows = await db
    .select({
      id:          organizations.id,
      slug:        organizations.slug,
      name:        organizations.name,
      createdAt:   organizations.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM ${memberships} WHERE ${memberships.organizationId} = ${organizations.id})`,
      eventCount:  sql<number>`(SELECT count(*)::int FROM ${events} WHERE ${events.organizationId} = ${organizations.id})`,
    })
    .from(organizations)
    .orderBy(organizations.createdAt);
  res.json({ organizations: rows });
}

// ── Membership CRUD (#72) — all org-scoped via forOrg ─────────────────────────

/** GET /api/orgs/:orgSlug/members — list members of THIS org only. */
export async function listMembersHandler(req: Request, res: Response) {
  const scope = forOrg(req.orgContext!.id);
  const rows = await scope.db
    .select({
      id:          memberships.id,
      accountId:   memberships.accountId,
      role:        memberships.role,
      displayName: accounts.displayName,
      email:       accounts.email,
      createdAt:   memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(accounts, eq(memberships.accountId, accounts.id))
    .where(scope.owns(memberships))
    .orderBy(memberships.createdAt);
  res.json({ members: rows });
}

/** POST /api/orgs/:orgSlug/members — manager+ adds a member. */
export async function addMemberHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { accountId, role } = req.body as { accountId?: string; role?: string };
  if (!accountId) {
    sendError(res, 400, 'validation', 'accountId is required');
    return;
  }
  if (!isOrgRole(role)) {
    sendError(res, 400, 'validation', `role must be one of: ${ORG_ROLES.join(', ')}`);
    return;
  }
  try {
    const [created] = await db
      .insert(memberships)
      .values({ organizationId: org.id, accountId, role })
      .returning({ id: memberships.id, accountId: memberships.accountId, role: memberships.role });
    res.status(201).json({ member: created });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      sendError(res, 409, 'validation', 'Account is already a member of this organization');
      return;
    }
    if (pgErrorCode(err) === '23503') {
      sendError(res, 400, 'validation', 'accountId does not reference a known account');
      return;
    }
    throw err;
  }
}

/** PATCH /api/orgs/:orgSlug/members/:membershipId — owner changes a member's role. */
export async function updateMemberHandler(req: Request, res: Response) {
  const scope = forOrg(req.orgContext!.id);
  const { membershipId } = req.params;
  const { role } = req.body as { role?: string };
  if (!isOrgRole(role)) {
    sendError(res, 400, 'validation', `role must be one of: ${ORG_ROLES.join(', ')}`);
    return;
  }

  // Demoting the final owner would orphan the tenant — block it.
  if (role !== 'owner') {
    const [target] = await scope.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), scope.owns(memberships)));
    if (target?.role === 'owner' && (await ownerCount(scope.organizationId)) <= 1) {
      sendError(res, 409, 'validation', 'Cannot demote the last owner of the organization');
      return;
    }
  }

  const [updated] = await scope.db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.id, membershipId), scope.owns(memberships)))
    .returning({ id: memberships.id, accountId: memberships.accountId, role: memberships.role });
  if (!updated) {
    sendError(res, 404, 'not_found', 'Membership not found in this organization');
    return;
  }
  res.json({ member: updated });
}

/** DELETE /api/orgs/:orgSlug/members/:membershipId — owner removes a member. */
export async function removeMemberHandler(req: Request, res: Response) {
  const scope = forOrg(req.orgContext!.id);
  const { membershipId } = req.params;

  const [target] = await scope.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), scope.owns(memberships)));
  if (!target) {
    sendError(res, 404, 'not_found', 'Membership not found in this organization');
    return;
  }
  if (target.role === 'owner' && (await ownerCount(scope.organizationId)) <= 1) {
    sendError(res, 409, 'validation', 'Cannot remove the last owner of the organization');
    return;
  }

  await scope.db
    .delete(memberships)
    .where(and(eq(memberships.id, membershipId), scope.owns(memberships)));
  res.status(204).end();
}

async function ownerCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'owner')));
  return row?.n ?? 0;
}
