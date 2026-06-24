// Owner: Rusty (event reads)
import { and, eq } from 'drizzle-orm';
import { db, events, areas } from '../db/index.js';

export interface EventRow {
  id:   string;
  slug: string;
  name: string;
  status: string;
  owner_id: string;
  organization_id: string;
  default_area_id: string;
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const [row] = await db
    .select({
      id:       events.id,
      slug:     events.slug,
      name:     events.name,
      status:   events.status,
      owner_id: events.ownerId,
      organization_id: events.organizationId,
      default_area_id: areas.id,
    })
    .from(events)
    .innerJoin(areas, and(eq(areas.eventId, events.id), eq(areas.isDefault, true)))
    .where(eq(events.slug, slug))
    .limit(1);
  return row ?? null;
}
