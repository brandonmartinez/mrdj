// Owner: Rusty (credits reads) | Frank (write paths)
import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';

export interface Bundle {
  id:           string;
  label:        string;
  credits:      number;
  bonusCredits: number;
  priceCents:   number;
  discountPct:  number;
}

export async function getBundlesHandler(_req: Request, res: Response) {
  const result = await pool.query(
    `SELECT id, label, credits, bonus_credits, price_cents, discount_pct
     FROM credit_bundles
     ORDER BY sort_order ASC`,
  );

  const bundles: Bundle[] = result.rows.map(r => ({
    id:           r.id,
    label:        r.label,
    credits:      r.credits,
    bonusCredits: r.bonus_credits,
    priceCents:   r.price_cents,
    discountPct:  parseFloat(r.discount_pct),
  }));

  res.json(bundles);
}
