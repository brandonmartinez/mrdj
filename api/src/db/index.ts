// Owner: Rusty (Drizzle client — D8 data layer)
// Wraps the existing PgBouncer-safe pg Pool (src/db/pool.ts) so the money-path
// connection rules (no named prepared statements) still hold: the node-postgres
// driver issues unnamed, parameterised statements.
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './pool.js';
import * as schema from './schema.js';

export const db = drizzle(pool, { schema });
export type DB = typeof db;

/** A Drizzle transaction handle (the value passed to `db.transaction(cb)`). */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Either the root db or an open transaction. Service functions accept this so
 * callers can run them standalone (`db`) or enlist them in an existing
 * transaction (`tx`) — the seam that keeps money paths atomic across modules.
 */
export type DbExecutor = DB | Tx;

export { schema };
export * from './schema.js';

/**
 * Tenant query seam (Epic 1 stub for D7 multi-tenancy).
 *
 * Today this is a no-op pass-through: no table carries `organization_id` yet, so
 * there is nothing to scope. When the multi-tenant schema lands (Epic 2) this
 * becomes the single choke point that constrains every query to one tenant —
 * callers already routing through `forOrg(orgId)` get isolation for free.
 */
export function forOrg(_organizationId: string): DB {
  // TODO(multi-tenant, Epic 2): apply organization_id scoping here.
  return db;
}

/**
 * Extract a Postgres error code (e.g. '23505' unique_violation, '23514' check_violation)
 * from a thrown error. Drizzle may surface the original node-postgres error directly OR
 * wrap it (with the original under `.cause`), so check both. This keeps the money-path
 * race recovery (idempotency 23505, overspend 23514) working regardless of wrapping.
 */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null | undefined;
  return e?.code ?? e?.cause?.code;
}
