// Owner: Rusty (event reads)
import { eq } from 'drizzle-orm';
import { db, events } from '../db/index.js';

export interface EventRow {
  id:   string;
  slug: string;
  name: string;
  status: string;
  owner_id: string;
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const [row] = await db
    .select({
      id:       events.id,
      slug:     events.slug,
      name:     events.name,
      status:   events.status,
      owner_id: events.ownerId,
    })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);
  return row ?? null;
}
