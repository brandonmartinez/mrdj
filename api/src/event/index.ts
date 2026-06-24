// Owner: Rusty (event reads)
import { pool } from '../db/pool.js';

export interface EventRow {
  id:   string;
  slug: string;
  name: string;
  status: string;
  owner_id: string;
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const result = await pool.query(
    `SELECT id, slug, name, status, owner_id FROM events WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return result.rows[0] ?? null;
}
