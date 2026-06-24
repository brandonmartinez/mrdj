// Owner: Frank — guest credit purchase (Epic 4, #30, O11).
// Creates a Stripe PaymentIntent as a destination charge to the org's connected
// account, taking the platform application fee, and returns a client_secret for the
// frontend Payment Element. Raw card data never touches the server. Credits are NOT
// granted here — that happens idempotently in the payment_intent.succeeded webhook (#34).
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, organizations } from '../db/index.js';
import { cfg } from '../config/index.js';
import { sendError } from '../http/middleware.js';
import { getStripe } from './client.js';
import { getBundleForOrg } from './pricing.js';

/** Platform application fee in cents for a given gross amount (O11, banker-safe round). */
export function applicationFeeCents(amountCents: number, feePercent = cfg.platformFeePercent): number {
  return Math.round((amountCents * feePercent) / 100);
}

/**
 * POST /api/orgs/:orgSlug/credits/purchase  body: { bundleId, clientRequestId? }
 * Mounted behind resolveOrg + requireChargesEnabled. Returns a PaymentIntent
 * client_secret; the webhook grants credits once the charge succeeds.
 */
export async function purchaseHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const userId = req.session.userId!;
  const { bundleId, clientRequestId } = req.body as { bundleId?: string; clientRequestId?: string };

  if (!bundleId) { sendError(res, 400, 'validation', 'bundleId is required'); return; }

  const bundle = await getBundleForOrg(org.id, bundleId);
  if (!bundle || !bundle.active) {
    sendError(res, 404, 'not_found', `Bundle '${bundleId}' not found`);
    return;
  }

  const [orgRow] = await db
    .select({ stripeAccountId: organizations.stripeAccountId })
    .from(organizations)
    .where(eq(organizations.id, org.id));
  if (!orgRow?.stripeAccountId) {
    // charges_enabled implies an account, but guard against a torn state.
    res.status(402).json({
      error: { code: 'payments_unavailable', message: 'This organizer is not set up to accept payments.' },
    });
    return;
  }

  const totalCredits = bundle.credits + bundle.bonusCredits;
  const feeCents     = applicationFeeCents(bundle.priceCents);

  // Org-scoped idempotency key (#30). A stable clientRequestId makes a network retry
  // of the same click return the same PaymentIntent; a fresh purchase uses a new id.
  const idempotencyKey = `purchase-${org.id}-${bundleId}-${userId}-${clientRequestId ?? randomUUID()}`;

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      amount:                 bundle.priceCents,
      currency:               cfg.paymentsCurrency,
      application_fee_amount: feeCents,
      transfer_data:          { destination: orgRow.stripeAccountId },
      automatic_payment_methods: { enabled: true },
      metadata: {
        organizationId:      org.id,
        userId,
        bundleId,
        creditsGranted:      String(totalCredits),
        applicationFeeCents: String(feeCents),
      },
    },
    { idempotencyKey },
  );

  res.json({
    clientSecret:        intent.client_secret,
    paymentIntentId:     intent.id,
    publishableKey:      cfg.stripePublishableKey,
    amountCents:         bundle.priceCents,
    applicationFeeCents: feeCents,
    credits:             totalCredits,
  });
}
