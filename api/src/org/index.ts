// Owner: Rusty (tenant/organization reads + forOrg seam helpers)
import { and, eq, asc } from 'drizzle-orm';
import { db, organizations, memberships, accounts, type DbExecutor } from '../db/index.js';

export const ORG_ROLES = ['owner', 'manager', 'dj', 'staff'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Higher rank = more privilege. Used by requireMembership(minRole) guards. */
const ROLE_RANK: Record<OrgRole, number> = { owner: 3, manager: 2, dj: 1, staff: 0 };

/** True when `role` meets or exceeds `minRole` in the org-role hierarchy. */
export function roleSatisfies(role: OrgRole, minRole: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export interface OrganizationRow {
  id:   string;
  slug: string;
  name: string;
  logoUrl:     string | null;
  heroUrl:     string | null;
  accentColor: string | null;
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
    .select({
      id: organizations.id, slug: organizations.slug, name: organizations.name,
      logoUrl: organizations.logoUrl, heroUrl: organizations.heroUrl, accentColor: organizations.accentColor,
    })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Resolve an Organization by id. */
export async function getOrgById(id: string, executor: DbExecutor = db): Promise<OrganizationRow | null> {
  const [row] = await executor
    .select({
      id: organizations.id, slug: organizations.slug, name: organizations.name,
      logoUrl: organizations.logoUrl, heroUrl: organizations.heroUrl, accentColor: organizations.accentColor,
    })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return row ?? null;
}

export interface MembershipRow {
  id:             string;
  organizationId: string;
  accountId:      string;
  role:           OrgRole;
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

/**
 * Resolve a session user's Membership in an Organization.
 *
 * Sessions carry a `users.id`; memberships hang off `accounts.id`. This joins the
 * two so route guards can authorize the logged-in account against the path org.
 * Returns null when the user has no account, or no membership in that org.
 */
export async function getMembershipForUser(
  organizationId: string,
  userId:         string,
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
    .innerJoin(accounts, eq(memberships.accountId, accounts.id))
    .where(and(eq(memberships.organizationId, organizationId), eq(accounts.userId, userId)))
    .limit(1);
  return (row as MembershipRow | undefined) ?? null;
}
