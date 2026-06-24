// Owner: Rusty (Event CRUD HTTP handlers — Epic 6, #41/#44)
//
// Events belong to exactly one Organization (D7) and are addressed under
// /api/orgs/:orgSlug/events/:eventSlug. Creating an Event also creates its
// mandatory default Area (O15 invariant: every Event has at least one Area, and
// getEventBySlug innerJoins the default Area). All reads/writes are org-scoped
// through forOrg so one tenant can never touch another's events.
import type { Request, Response } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  db, forOrg, events, areas, memberships, accounts, pgErrorCode,
} from '../db/index.js';
import { sendError } from '../http/middleware.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const STATUSES = ['draft', 'live', 'ended'] as const;
type EventStatus = (typeof STATUSES)[number];

function isStatus(v: unknown): v is EventStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Validate a lead-DJ accountId is a member of this org; returns its id or null. */
async function resolveLeadDj(orgId: string, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: memberships.accountId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.accountId, accountId)))
    .limit(1);
  return row?.id ?? null;
}

/** Resolve the session account id (the default lead DJ when none is supplied). */
async function sessionAccountId(req: Request): Promise<string | null> {
  const userId = req.session.userId;
  if (!userId) return null;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

/** GET /api/orgs/:orgSlug/events — list this org's events (+ area count). */
export async function listEventsHandler(req: Request, res: Response) {
  const scope = forOrg(req.orgContext!.id);
  const rows = await scope.db
    .select({
      id:        events.id,
      slug:      events.slug,
      name:      events.name,
      status:    events.status,
      ownerId:   events.ownerId,
      ownerName: accounts.displayName,
      createdAt: events.createdAt,
      areaCount: sql<number>`(SELECT count(*)::int FROM ${areas} WHERE ${areas.eventId} = ${events.id})`,
    })
    .from(events)
    .leftJoin(accounts, eq(events.ownerId, accounts.id))
    .where(scope.owns(events))
    .orderBy(asc(events.createdAt));
  res.json({ events: rows });
}

/** GET /api/orgs/:orgSlug/events/:eventSlug — one event with its default area. */
export async function getEventHandler(req: Request, res: Response) {
  const scope = forOrg(req.orgContext!.id);
  const [row] = await scope.db
    .select({
      id:        events.id,
      slug:      events.slug,
      name:      events.name,
      status:    events.status,
      ownerId:   events.ownerId,
      ownerName: accounts.displayName,
      createdAt: events.createdAt,
    })
    .from(events)
    .leftJoin(accounts, eq(events.ownerId, accounts.id))
    .where(and(eq(events.slug, req.params.eventSlug), scope.owns(events)))
    .limit(1);
  if (!row) {
    sendError(res, 404, 'not_found', `Event '${req.params.eventSlug}' not found in this organization`);
    return;
  }
  res.json({ event: row });
}

/**
 * POST /api/orgs/:orgSlug/events — manager+ creates an event + default area.
 *
 * Body: { slug, name, leadDjAccountId? }. leadDjAccountId defaults to the
 * creating account and must be a member of the org. Event slugs are globally
 * unique (DB constraint) — a collision returns 409.
 */
export async function createEventHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { slug, name, leadDjAccountId, defaultAreaName } = req.body as {
    slug?: string; name?: string; leadDjAccountId?: string; defaultAreaName?: string;
  };
  if (!slug || !SLUG_RE.test(slug)) {
    sendError(res, 400, 'validation', 'slug must be 1–40 lowercase alphanumerics/hyphens');
    return;
  }
  if (!name || !name.trim()) {
    sendError(res, 400, 'validation', 'name is required');
    return;
  }

  const ownerId = leadDjAccountId ?? (await sessionAccountId(req));
  if (!ownerId) {
    sendError(res, 400, 'validation', 'A lead DJ (account) is required');
    return;
  }
  if (!(await resolveLeadDj(org.id, ownerId))) {
    sendError(res, 400, 'validation', 'leadDjAccountId must be a member of this organization');
    return;
  }

  try {
    const event = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(events)
        .values({ slug, name: name.trim(), ownerId, organizationId: org.id, status: 'draft' })
        .returning({
          id: events.id, slug: events.slug, name: events.name,
          status: events.status, ownerId: events.ownerId, createdAt: events.createdAt,
        });

      const [area] = await tx
        .insert(areas)
        .values({
          eventId:        created.id,
          organizationId: org.id,
          name:           defaultAreaName?.trim() || 'Main Floor',
          isDefault:      true,
        })
        .returning({ id: areas.id, name: areas.name });

      return { ...created, defaultAreaId: area.id, defaultAreaName: area.name };
    });
    res.status(201).json({ event });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      sendError(res, 409, 'validation', `Event slug '${slug}' is already taken`);
      return;
    }
    throw err;
  }
}

/** PATCH /api/orgs/:orgSlug/events/:eventSlug — manager+ updates name/status/lead DJ. */
export async function updateEventHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const scope = forOrg(org.id);
  const { name, status, leadDjAccountId } = req.body as {
    name?: string; status?: string; leadDjAccountId?: string;
  };

  const patch: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) {
      sendError(res, 400, 'validation', 'name cannot be empty');
      return;
    }
    patch.name = name.trim();
  }
  if (status !== undefined) {
    if (!isStatus(status)) {
      sendError(res, 400, 'validation', `status must be one of: ${STATUSES.join(', ')}`);
      return;
    }
    patch.status = status;
    if (status === 'live') patch.startedAt = sql`now()`;
    if (status === 'ended') patch.endedAt = sql`now()`;
  }
  if (leadDjAccountId !== undefined) {
    if (!(await resolveLeadDj(org.id, leadDjAccountId))) {
      sendError(res, 400, 'validation', 'leadDjAccountId must be a member of this organization');
      return;
    }
    patch.ownerId = leadDjAccountId;
  }
  if (Object.keys(patch).length === 0) {
    sendError(res, 400, 'validation', 'Provide at least one of: name, status, leadDjAccountId');
    return;
  }

  const [updated] = await scope.db
    .update(events)
    .set(patch)
    .where(and(eq(events.slug, req.params.eventSlug), scope.owns(events)))
    .returning({
      id: events.id, slug: events.slug, name: events.name,
      status: events.status, ownerId: events.ownerId, createdAt: events.createdAt,
    });
  if (!updated) {
    sendError(res, 404, 'not_found', `Event '${req.params.eventSlug}' not found in this organization`);
    return;
  }
  res.json({ event: updated });
}
