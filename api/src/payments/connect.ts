// Owner: Frank — Stripe Connect Express onboarding (Epic 4, #20, O10/O14).
// Provisions a connected Express account per Organization (idempotent on retry) and
// returns a Stripe-hosted Account Link so the DJ can complete KYC. charges_enabled /
// payouts_enabled are mirrored back asynchronously via the account.updated webhook (#23).
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, organizations } from '../db/index.js';
import { cfg } from '../config/index.js';
import { sendError } from '../http/middleware.js';
import { getStripe } from './client.js';
import { PaymentConfigError } from './provider.js';

/**
 * POST /api/orgs/:orgSlug/stripe/connect
 * Creates (or reuses) the org's Express account and returns a fresh onboarding link.
 * Mounted behind resolveOrg + requireMembership('manager') so the caller is verified
 * as a member of the target org before any Stripe call.
 */
export async function connectOnboardingHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const stripe = getStripe();

  // Read the current connected-account id under a row lock so two concurrent
  // onboarding requests can't each create a duplicate Stripe account.
  const accountId = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ stripeAccountId: organizations.stripeAccountId })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .for('update');
    if (row?.stripeAccountId) return row.stripeAccountId;

    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { organizationId: org.id, organizationSlug: org.slug },
    });
    await tx
      .update(organizations)
      .set({ stripeAccountId: account.id })
      .where(eq(organizations.id, org.id));
    return account.id;
  });

  const link = await stripe.accountLinks.create({
    account:     accountId,
    refresh_url: cfg.stripeConnectRefreshUrl,
    return_url:  cfg.stripeConnectReturnUrl,
    type:        'account_onboarding',
  });

  res.json({ accountId, url: link.url });
}

/**
 * GET /api/orgs/:orgSlug/stripe/status — current onboarding/payout readiness.
 * Reads the mirrored flags (no Stripe call); the webhook keeps them fresh.
 */
export async function connectStatusHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const [row] = await db
    .select({
      stripeAccountId: organizations.stripeAccountId,
      chargesEnabled:  organizations.chargesEnabled,
      payoutsEnabled:  organizations.payoutsEnabled,
    })
    .from(organizations)
    .where(eq(organizations.id, org.id));
  res.json({
    connected:      !!row?.stripeAccountId,
    chargesEnabled: row?.chargesEnabled ?? false,
    payoutsEnabled: row?.payoutsEnabled ?? false,
  });
}

/** Express error filter: surface payment misconfiguration as a 503 (not a 500). */
export function isPaymentConfigError(err: unknown): err is PaymentConfigError {
  return err instanceof PaymentConfigError;
}
