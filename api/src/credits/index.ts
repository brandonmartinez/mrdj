// Owner: Rusty (credits reads) | Frank (write paths)
import type { Request, Response } from 'express';
import { getDefaultOrgId } from '../org/index.js';
import { listBundlesForOrg, type BundleRow } from '../payments/pricing.js';

export type Bundle = Omit<BundleRow, 'sortOrder' | 'active'>;

/**
 * GET /api/credits/bundles — legacy single-tenant route. Returns the default
 * Organization's active bundles. Per-org management lives at
 * /api/orgs/:orgSlug/bundles (Epic 4, #43).
 */
export async function getBundlesHandler(_req: Request, res: Response) {
  const orgId = await getDefaultOrgId();
  if (!orgId) { res.json([]); return; }
  const rows = await listBundlesForOrg(orgId, true);
  const bundles: Bundle[] = rows.map(r => ({
    id:           r.id,
    label:        r.label,
    credits:      r.credits,
    bonusCredits: r.bonusCredits,
    priceCents:   r.priceCents,
    discountPct:  r.discountPct,
  }));
  res.json(bundles);
}
