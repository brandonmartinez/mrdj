// Owner: Rusty (credits reads) | Frank (write paths)
import type { Request, Response } from 'express';
import { asc } from 'drizzle-orm';
import { db, creditBundles } from '../db/index.js';

export interface Bundle {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number;
}

export async function getBundlesHandler(_req: Request, res: Response) {
  const rows = await db
    .select({
      id:           creditBundles.id,
      label:        creditBundles.label,
      credits:      creditBundles.credits,
      bonusCredits: creditBundles.bonusCredits,
      priceCents:   creditBundles.priceCents,
      discountPct:  creditBundles.discountPct,
    })
    .from(creditBundles)
    .orderBy(asc(creditBundles.sortOrder));

  const bundles: Bundle[] = rows.map(r => ({
    id:           r.id,
    label:        r.label,
    credits:      r.credits,
    bonusCredits: r.bonusCredits,
    priceCents:   r.priceCents,
    discountPct:  parseFloat(r.discountPct),
  }));

  res.json(bundles);
}
