// Owner: Frank — PlatformPayment ledger reads (Epic 4, #48).
// Org owners/managers see their own earnings; Platform Admins see an aggregate across
// all orgs. Both read-only and strictly organization_id-scoped (no cross-tenant leak).
import type { Request, Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db, platformPayments, organizations } from '../db/index.js';

/**
 * GET /api/orgs/:orgSlug/payments — this org's payment history + earnings summary.
 * Earnings = gross amount minus the platform application fee. Disputed/refunded rows
 * are included for visibility but excluded from the net earnings total.
 */
export async function orgPaymentsHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const rows = await db
    .select()
    .from(platformPayments)
    .where(eq(platformPayments.organizationId, org.id))
    .orderBy(desc(platformPayments.createdAt));

  const payments = rows.map((r) => ({
    id:                  r.id,
    userId:              r.userId,
    bundleId:            r.bundleId,
    amountCents:         r.amountCents,
    applicationFeeCents: r.applicationFeeCents,
    netCents:            r.amountCents - r.applicationFeeCents,
    currency:            r.currency,
    creditsGranted:      r.creditsGranted,
    status:              r.status,
    createdAt:           r.createdAt,
  }));

  const succeeded = payments.filter((p) => p.status === 'succeeded');
  const summary = {
    grossCents:   succeeded.reduce((s, p) => s + p.amountCents, 0),
    feeCents:     succeeded.reduce((s, p) => s + p.applicationFeeCents, 0),
    netCents:     succeeded.reduce((s, p) => s + p.netCents, 0),
    count:        succeeded.length,
    disputedCount: payments.filter((p) => p.status === 'disputed').length,
    refundedCount: payments.filter((p) => p.status === 'refunded').length,
  };

  res.json({ payments, summary });
}

/**
 * GET /api/admin/payments — Platform Admin aggregate across all orgs.
 * Returns per-org rollups (gross, platform fee, net to org) plus a grand total.
 */
export async function platformPaymentsHandler(_req: Request, res: Response) {
  const rows = await db
    .select({
      organizationId: platformPayments.organizationId,
      orgName:        organizations.name,
      orgSlug:        organizations.slug,
      status:         platformPayments.status,
      grossCents:     sql<number>`sum(${platformPayments.amountCents})::int`,
      feeCents:       sql<number>`sum(${platformPayments.applicationFeeCents})::int`,
      count:          sql<number>`count(*)::int`,
    })
    .from(platformPayments)
    .innerJoin(organizations, eq(platformPayments.organizationId, organizations.id))
    .groupBy(platformPayments.organizationId, organizations.name, organizations.slug, platformPayments.status);

  // Fold the per-(org,status) rows into per-org rollups.
  const byOrg = new Map<string, {
    organizationId: string; orgName: string; orgSlug: string;
    grossCents: number; platformFeeCents: number; count: number;
    disputedCount: number; refundedCount: number;
  }>();
  let platformFeeTotal = 0;
  let grossTotal = 0;

  for (const r of rows) {
    const e = byOrg.get(r.organizationId) ?? {
      organizationId: r.organizationId, orgName: r.orgName, orgSlug: r.orgSlug,
      grossCents: 0, platformFeeCents: 0, count: 0, disputedCount: 0, refundedCount: 0,
    };
    if (r.status === 'succeeded') {
      e.grossCents       += r.grossCents;
      e.platformFeeCents += r.feeCents;
      e.count            += r.count;
      platformFeeTotal   += r.feeCents;
      grossTotal         += r.grossCents;
    } else if (r.status === 'disputed') {
      e.disputedCount += r.count;
    } else if (r.status === 'refunded') {
      e.refundedCount += r.count;
    }
    byOrg.set(r.organizationId, e);
  }

  res.json({
    organizations: Array.from(byOrg.values()),
    totals: { grossCents: grossTotal, platformFeeCents: platformFeeTotal },
  });
}
