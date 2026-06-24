// Owner: Rusty (Area management HTTP handlers — Epic 2, #74)
//
// Areas are Event subdivisions (zones/stages). MVP scope: area metadata CRUD only.
// The live queue + Play Next slot still operate on each Event's default Area
// (play_next_slot is keyed per-event today); per-area queue routing is future work.
import type { Request, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, forOrg, areas, events, queueItems } from '../db/index.js';
import { sendError } from '../http/middleware.js';

/** Resolve `:eventSlug` within the request's org scope (cross-tenant → 404). */
async function loadScopedEvent(req: Request, res: Response): Promise<{ id: string } | null> {
  const scope = forOrg(req.orgContext!.id);
  const [event] = await scope.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.slug, req.params.eventSlug), scope.owns(events)))
    .limit(1);
  if (!event) {
    sendError(res, 404, 'not_found', `Event '${req.params.eventSlug}' not found in this organization`);
    return null;
  }
  return event;
}

/** GET …/events/:eventSlug/areas — list this event's areas (org-scoped). */
export async function listAreasHandler(req: Request, res: Response) {
  const event = await loadScopedEvent(req, res);
  if (!event) return;
  const scope = forOrg(req.orgContext!.id);
  const rows = await scope.db
    .select({
      id:        areas.id,
      name:      areas.name,
      isDefault: areas.isDefault,
      createdAt: areas.createdAt,
    })
    .from(areas)
    .where(and(eq(areas.eventId, event.id), scope.owns(areas)))
    .orderBy(areas.createdAt);
  res.json({ areas: rows });
}

/** POST …/events/:eventSlug/areas — manager+ adds an area. */
export async function createAreaHandler(req: Request, res: Response) {
  const event = await loadScopedEvent(req, res);
  if (!event) return;
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    sendError(res, 400, 'validation', 'name is required');
    return;
  }
  const [created] = await db
    .insert(areas)
    .values({
      eventId:        event.id,
      organizationId: req.orgContext!.id,
      name:           name.trim(),
      isDefault:      false,
    })
    .returning({ id: areas.id, name: areas.name, isDefault: areas.isDefault });
  res.status(201).json({ area: created });
}

/** PATCH …/areas/:areaId — manager+ renames or re-flags the default area. */
export async function updateAreaHandler(req: Request, res: Response) {
  const event = await loadScopedEvent(req, res);
  if (!event) return;
  const scope = forOrg(req.orgContext!.id);
  const { areaId } = req.params;
  const { name, isDefault } = req.body as { name?: string; isDefault?: boolean };

  if (name !== undefined && !name.trim()) {
    sendError(res, 400, 'validation', 'name cannot be empty');
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.id, areaId), eq(areas.eventId, event.id), eq(areas.organizationId, scope.organizationId)));
    if (!existing) return null;

    // Promote to default → demote the event's current default (one default per event).
    if (isDefault === true) {
      await tx.update(areas)
        .set({ isDefault: false })
        .where(and(eq(areas.eventId, event.id), eq(areas.organizationId, scope.organizationId)));
    }

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (isDefault === true) patch.isDefault = true;
    if (Object.keys(patch).length === 0) {
      const [row] = await tx.select({ id: areas.id, name: areas.name, isDefault: areas.isDefault })
        .from(areas).where(eq(areas.id, areaId));
      return row;
    }
    const [row] = await tx.update(areas)
      .set(patch)
      .where(eq(areas.id, areaId))
      .returning({ id: areas.id, name: areas.name, isDefault: areas.isDefault });
    return row;
  });

  if (!updated) {
    sendError(res, 404, 'not_found', 'Area not found in this event');
    return;
  }
  res.json({ area: updated });
}

/** DELETE …/areas/:areaId — manager+ deletes a non-default, empty area. */
export async function deleteAreaHandler(req: Request, res: Response) {
  const event = await loadScopedEvent(req, res);
  if (!event) return;
  const scope = forOrg(req.orgContext!.id);
  const { areaId } = req.params;

  const [area] = await scope.db
    .select({ id: areas.id, isDefault: areas.isDefault })
    .from(areas)
    .where(and(eq(areas.id, areaId), eq(areas.eventId, event.id), scope.owns(areas)));
  if (!area) {
    sendError(res, 404, 'not_found', 'Area not found in this event');
    return;
  }
  if (area.isDefault) {
    sendError(res, 409, 'validation', 'The default area cannot be deleted');
    return;
  }

  const [{ n }] = await scope.db
    .select({ n: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(eq(queueItems.areaId, areaId));
  if (n > 0) {
    sendError(res, 409, 'validation', 'Cannot delete an area that still has queued tracks');
    return;
  }

  await db.delete(areas).where(eq(areas.id, areaId));
  res.status(204).end();
}
