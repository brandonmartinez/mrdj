// Owner: Frank — per-Organization pricing config + credit bundles (Epic 4, #43, O9).
// New Organizations inherit platform defaults; owners/managers may override later.
// The guest purchase flow (#30) reads bundles from here at checkout time.
import type { Request, Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { db, creditBundles, pricingConfig, type DbExecutor } from '../db/index.js';
import { sendError } from '../http/middleware.js';

export interface BundleInput {
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct?: number;
  sortOrder?:   number;
  active?:      boolean;
}

/**
 * Platform-default credit bundles (O9). New orgs inherit these; the $-price maps to
 * `priceCents`, and `discountPct` reflects the bonus ratio for display only.
 */
export const PLATFORM_DEFAULT_BUNDLES: readonly Required<Omit<BundleInput, 'active'>>[] = [
  { label: 'Starter Pack', credits:  5, bonusCredits: 0, priceCents:  500, discountPct:  0,     sortOrder: 1 },
  { label: 'Party Pack',   credits: 10, bonusCredits: 1, priceCents: 1000, discountPct:  9.09,  sortOrder: 2 },
  { label: 'VIP Pack',     credits: 20, bonusCredits: 4, priceCents: 2000, discountPct: 16.67,  sortOrder: 3 },
];

/** Platform-default pricing knobs (credits charged per action). */
export const PLATFORM_DEFAULT_PRICING: readonly { key: string; value: number }[] = [
  { key: 'queue',     value: 0 },
  { key: 'boost',     value: 1 },
  { key: 'play_next', value: 3 },
];

/**
 * Seed platform-default pricing + bundles for an Organization. Safe to replay:
 * pricing rows use onConflictDoNothing, and bundles are only inserted when the org
 * has none (so re-running never duplicates or clobbers owner customizations).
 * Call this inside the org-creation transaction.
 */
export async function seedOrgPricingDefaults(organizationId: string, executor: DbExecutor): Promise<void> {
  await executor
    .insert(pricingConfig)
    .values(PLATFORM_DEFAULT_PRICING.map((p) => ({ organizationId, key: p.key, value: p.value })))
    .onConflictDoNothing({ target: [pricingConfig.organizationId, pricingConfig.key] });

  const existing = await executor
    .select({ id: creditBundles.id })
    .from(creditBundles)
    .where(eq(creditBundles.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;

  await executor.insert(creditBundles).values(
    PLATFORM_DEFAULT_BUNDLES.map((b) => ({
      organizationId,
      label:        b.label,
      credits:      b.credits,
      bonusCredits: b.bonusCredits,
      priceCents:   b.priceCents,
      discountPct:  b.discountPct.toFixed(2),
      sortOrder:    b.sortOrder,
    })),
  );
}

export interface BundleRow {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number;
  sortOrder:    number;
  active:       boolean;
}

/** List an org's bundles (optionally only active ones — guests see active only). */
export async function listBundlesForOrg(
  organizationId: string,
  activeOnly = false,
  executor: DbExecutor = db,
): Promise<BundleRow[]> {
  const where = activeOnly
    ? and(eq(creditBundles.organizationId, organizationId), eq(creditBundles.active, true))
    : eq(creditBundles.organizationId, organizationId);
  const rows = await executor
    .select()
    .from(creditBundles)
    .where(where)
    .orderBy(asc(creditBundles.sortOrder));
  return rows.map(rowToBundle);
}

/** Resolve a single bundle within an org scope (null if missing / other org). */
export async function getBundleForOrg(
  organizationId: string,
  bundleId: string,
  executor: DbExecutor = db,
): Promise<BundleRow | null> {
  const [row] = await executor
    .select()
    .from(creditBundles)
    .where(and(eq(creditBundles.id, bundleId), eq(creditBundles.organizationId, organizationId)))
    .limit(1);
  return row ? rowToBundle(row) : null;
}

function rowToBundle(r: typeof creditBundles.$inferSelect): BundleRow {
  return {
    id:           r.id,
    label:        r.label,
    credits:      r.credits,
    bonusCredits: r.bonusCredits,
    priceCents:   r.priceCents,
    discountPct:  parseFloat(r.discountPct),
    sortOrder:    r.sortOrder,
    active:       r.active,
  };
}

type BundleCreditTotals = Pick<BundleInput, 'credits' | 'bonusCredits'>;

/** Validate a bundle payload; returns an error string or null. */
function validateBundle(input: Partial<BundleInput>, partial = false, existing?: BundleCreditTotals): string | null {
  const req = (n: keyof BundleInput) => input[n] !== undefined;
  if (!partial) {
    if (!input.label || typeof input.label !== 'string') return 'label is required';
    if (!req('credits')) return 'credits is required';
    if (!req('priceCents')) return 'priceCents is required';
  }
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.trim() === '')) return 'label must be a non-empty string';
  if (input.credits !== undefined && (!Number.isInteger(input.credits) || input.credits < 0)) return 'credits must be a non-negative integer';
  if (input.bonusCredits !== undefined && (!Number.isInteger(input.bonusCredits) || input.bonusCredits < 0)) return 'bonusCredits must be a non-negative integer';
  if (!partial || existing !== undefined) {
    if ((input.credits ?? existing?.credits ?? 0) + (input.bonusCredits ?? existing?.bonusCredits ?? 0) <= 0) return 'bundle must include at least one credit';
  }
  if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents <= 0)) return 'priceCents must be a positive integer';
  if (input.discountPct !== undefined && (typeof input.discountPct !== 'number' || input.discountPct < 0)) return 'discountPct must be a non-negative number';
  if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) return 'sortOrder must be an integer';
  return null;
}

// ── CRUD handlers (mounted under /api/orgs/:orgSlug/bundles; requireMembership) ──

export async function listBundlesHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  res.json(await listBundlesForOrg(org.id));
}

export async function createBundleHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const input = req.body as Partial<BundleInput>;
  const err = validateBundle(input);
  if (err) { sendError(res, 400, 'validation', err); return; }

  const [row] = await db.insert(creditBundles).values({
    organizationId: org.id,
    label:          input.label!,
    credits:        input.credits!,
    bonusCredits:   input.bonusCredits ?? 0,
    priceCents:     input.priceCents!,
    discountPct:    (input.discountPct ?? 0).toFixed(2),
    sortOrder:      input.sortOrder ?? 0,
    active:         input.active ?? true,
  }).returning();
  res.status(201).json(rowToBundle(row));
}

export async function updateBundleHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { bundleId } = req.params;
  const input = req.body as Partial<BundleInput>;
  const err = validateBundle(input, true);
  if (err) { sendError(res, 400, 'validation', err); return; }

  const set: Record<string, unknown> = {};
  if (input.label !== undefined)        set.label        = input.label;
  if (input.credits !== undefined)      set.credits      = input.credits;
  if (input.bonusCredits !== undefined) set.bonusCredits = input.bonusCredits;
  if (input.priceCents !== undefined)   set.priceCents   = input.priceCents;
  if (input.discountPct !== undefined)  set.discountPct  = input.discountPct.toFixed(2);
  if (input.sortOrder !== undefined)    set.sortOrder    = input.sortOrder;
  if (input.active !== undefined)       set.active       = input.active;
  if (Object.keys(set).length === 0) { sendError(res, 400, 'validation', 'no fields to update'); return; }

  const existing = (input.credits !== undefined || input.bonusCredits !== undefined)
    ? await getBundleForOrg(org.id, bundleId)
    : null;
  if ((input.credits !== undefined || input.bonusCredits !== undefined) && !existing) {
    sendError(res, 404, 'not_found', `Bundle '${bundleId}' not found`);
    return;
  }
  const totalErr = validateBundle(input, true, existing ?? undefined);
  if (totalErr) { sendError(res, 400, 'validation', totalErr); return; }

  const [row] = await db
    .update(creditBundles)
    .set(set)
    .where(and(eq(creditBundles.id, bundleId), eq(creditBundles.organizationId, org.id)))
    .returning();
  if (!row) { sendError(res, 404, 'not_found', `Bundle '${bundleId}' not found`); return; }
  res.json(rowToBundle(row));
}

export async function deleteBundleHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { bundleId } = req.params;
  const [row] = await db
    .delete(creditBundles)
    .where(and(eq(creditBundles.id, bundleId), eq(creditBundles.organizationId, org.id)))
    .returning({ id: creditBundles.id });
  if (!row) { sendError(res, 404, 'not_found', `Bundle '${bundleId}' not found`); return; }
  res.status(204).end();
}
