// Owner: Rusty (tenant/organization reads + forOrg seam helpers)
import { and, eq, asc } from 'drizzle-orm';
import { db, organizations, memberships, type DbExecutor } from '../db/index.js';

export interface OrganizationRow {
  id:   string;
  slug: string;
  name: string;
}

/**
 * Resolve the default Organization id (single-tenant MVP convenience).
 *
 * Until real multi-org flows exist, credit grants that aren't tied to a specific
 * Event (admin grants, stub checkout) book against the default tenant — the same
 * Organization a guest spends in. Picks the oldest Organization deterministically.
 */
export async function getDefaultOrgId(executor: DbExecutor = db): Promise<string | null> {
  const [row] = await executor
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Resolve an Organization by its slug (for /o/{slug} routing). */
export async function getOrgBySlug(slug: string, executor: DbExecutor = db): Promise<OrganizationRow | null> {
  const [row] = await executor
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Resolve an Organization by id. */
export async function getOrgById(id: string, executor: DbExecutor = db): Promise<OrganizationRow | null> {
  const [row] = await executor
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return row ?? null;
}

export interface MembershipRow {
  id:             string;
  organizationId: string;
  accountId:      string;
  role:           'owner' | 'manager' | 'dj' | 'staff';
}

/** Look up an account's Membership in an Organization (null if not a member). */
export async function getMembership(
  organizationId: string,
  accountId:      string,
  executor:       DbExecutor = db,
): Promise<MembershipRow | null> {
  const [row] = await executor
    .select({
      id:             memberships.id,
      organizationId: memberships.organizationId,
      accountId:      memberships.accountId,
      role:           memberships.role,
    })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.accountId, accountId)))
    .limit(1);
  return (row as MembershipRow | undefined) ?? null;
}
