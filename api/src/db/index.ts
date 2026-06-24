// Owner: Rusty (Drizzle client — D8 data layer)
// Wraps the existing PgBouncer-safe pg Pool (src/db/pool.ts) so the money-path
// connection rules (no named prepared statements) still hold: the node-postgres
// driver issues unnamed, parameterised statements.
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
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

/** Any tenant-scoped table exposes an `organizationId` column. */
export interface TenantTable {
  organizationId: PgColumn;
}

/**
 * A tenant query scope (D7 multi-tenancy, Epic 2).
 *
 * Drizzle has no global query filter, so isolation is enforced explicitly: every
 * org-scoped query composes `scope.owns(table)` into its WHERE clause. Routing all
 * tenant reads/writes through `forOrg(orgId)` keeps the `organization_id` predicate
 * in one place and makes cross-tenant leakage a visible omission rather than a
 * silent default.
 */
export interface OrgScope {
  readonly organizationId: string;
  readonly db: DB;
  /** WHERE predicate constraining a tenant table to this scope's organization. */
  owns(table: TenantTable): SQL;
}

export function forOrg(organizationId: string): OrgScope {
  return {
    organizationId,
    db,
    owns(table: TenantTable): SQL {
      return eq(table.organizationId, organizationId);
    },
  };
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
