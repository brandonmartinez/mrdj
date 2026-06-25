// Owner: Frank — Stripe webhooks (Epic 4, #23/#34/#37).
// Single signed endpoint. Every handler is idempotent: the event id is recorded in
// processed_webhook_events inside the same transaction as its side effect, so a
// replay is a safe no-op and a failed transaction lets Stripe retry. Signature is
// verified against the RAW request body (the route is mounted with express.raw).
import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { and, eq, sql } from 'drizzle-orm';
import {
  db, organizations, platformPayments, processedWebhookEvents, pgErrorCode, type DbExecutor,
} from '../db/index.js';
import { cfg } from '../config/index.js';
import { grantCredits } from '../credits/service.js';
import { getStripe } from './client.js';
import { PaymentConfigError } from './provider.js';

/** Emit a Platform Admin alert (MVP: structured log; swap for email/notification later). */
function alertPlatformAdmin(message: string, context: Record<string, unknown>): void {
  console.warn(`[platform-alert] ${message}`, context);
}

/**
 * POST /api/webhooks/stripe — verify signature, then dispatch by event type.
 * Returns 200 for handled/unhandled/replayed events; 400 only when the signature
 * fails; non-2xx when a side effect throws (so Stripe retries).
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!cfg.stripeWebhookSecret) {
    throw new PaymentConfigError('STRIPE_WEBHOOK_SECRET is not configured');
  }
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).json({ error: { code: 'validation', message: 'Missing stripe-signature header' } });
    return;
  }

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw). constructEvent needs the raw bytes.
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, cfg.stripeWebhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    res.status(400).json({ error: { code: 'validation', message: `Webhook signature verification failed: ${message}` } });
    return;
  }

  // Fast path: event already processed → no-op.
  const [seen] = await db
    .select({ eventId: processedWebhookEvents.eventId })
    .from(processedWebhookEvents)
    .where(eq(processedWebhookEvents.eventId, event.id));
  if (seen) { res.json({ received: true, duplicate: true }); return; }

  try {
    await db.transaction(async (tx) => {
      // Mark processed first; the UNIQUE PK turns a concurrent duplicate into 23505.
      await tx.insert(processedWebhookEvents).values({ eventId: event.id, type: event.type });

      switch (event.type) {
        case 'account.updated':
          await handleAccountUpdated(event.data.object as Stripe.Account, tx);
          break;
        case 'payment_intent.succeeded':
          await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, tx);
          break;
        case 'charge.dispute.created':
          await handleDisputeCreated(event.data.object as Stripe.Dispute, tx);
          break;
        default:
          // Unhandled event types are a 200 no-op (still recorded as processed).
          break;
      }
    });
  } catch (err) {
    // A concurrent delivery won the processed-event insert → treat as duplicate (200).
    if (pgErrorCode(err) === '23505') {
      res.json({ received: true, duplicate: true });
      return;
    }
    throw err; // genuine failure → non-2xx via error middleware → Stripe retries.
  }

  res.json({ received: true });
}

/** #23 — mirror charges_enabled / payouts_enabled from the connected account. */
async function handleAccountUpdated(account: Stripe.Account, tx: DbExecutor): Promise<void> {
  await tx
    .update(organizations)
    .set({
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    })
    .where(eq(organizations.stripeAccountId, account.id));
}

/**
 * #34 — grant from the server-owned pending PlatformPayment row. Stripe metadata is
 * not trusted for credits; it is only a carrier on the PaymentIntent.
 */
async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent, tx: DbExecutor): Promise<void> {
  const [purchase] = await tx
    .select()
    .from(platformPayments)
    .where(eq(platformPayments.stripePaymentIntentId, intent.id))
    .for('update');
  if (!purchase) {
    alertPlatformAdmin('payment_intent.succeeded without local pending purchase', {
      paymentIntentId: intent.id,
    });
    return;
  }
  if (purchase.status !== 'pending') return;

  const chargeId = typeof intent.latest_charge === 'string'
    ? intent.latest_charge
    : intent.latest_charge?.id ?? null;
  const amountCents = intent.amount_received || intent.amount;
  const destination = typeof intent.transfer_data?.destination === 'string'
    ? intent.transfer_data.destination
    : intent.transfer_data?.destination?.id ?? null;
  const expectedCurrency = purchase.currency.toLowerCase();
  const receivedCurrency = (intent.currency ?? cfg.paymentsCurrency).toLowerCase();
  const valid = intent.status === 'succeeded'
    && amountCents === purchase.amountCents
    && receivedCurrency === expectedCurrency
    && (!purchase.stripeConnectedAccountId || destination === purchase.stripeConnectedAccountId);

  if (!valid) {
    alertPlatformAdmin('payment_intent.succeeded failed local purchase validation', {
      paymentIntentId: intent.id,
      expectedAmountCents: purchase.amountCents,
      receivedAmountCents: amountCents,
      expectedCurrency,
      receivedCurrency,
      expectedDestination: purchase.stripeConnectedAccountId,
      receivedDestination: destination,
      receivedStatus: intent.status,
    });
    return;
  }

  const updated = await tx
    .update(platformPayments)
    .set({ stripeChargeId: chargeId, status: 'succeeded' })
    .where(and(eq(platformPayments.id, purchase.id), eq(platformPayments.status, 'pending')))
    .returning({ id: platformPayments.id });

  if (updated.length === 0) return;

  if (purchase.creditsGranted > 0) {
    await grantCredits(
      purchase.userId,
      purchase.organizationId,
      purchase.creditsGranted,
      'purchase',
      `purchase-${intent.id}`,
      undefined,
      tx,
    );
  }
}

/** #37 — flag the PlatformPayment as disputed and alert Platform Admins (no auto-reversal). */
async function handleDisputeCreated(dispute: Stripe.Dispute, tx: DbExecutor): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
  const paymentIntentId = typeof dispute.payment_intent === 'string'
    ? dispute.payment_intent
    : dispute.payment_intent?.id ?? null;

  // Prefer charge id; fall back to payment_intent id. Only flip succeeded→disputed
  // (already-disputed is a no-op, keeping replays idempotent).
  const updated = await tx
    .update(platformPayments)
    .set({ status: 'disputed' })
    .where(sql`${platformPayments.status} = 'succeeded' AND (
      ${chargeId !== null ? sql`${platformPayments.stripeChargeId} = ${chargeId}` : sql`false`}
      OR ${paymentIntentId !== null ? sql`${platformPayments.stripePaymentIntentId} = ${paymentIntentId}` : sql`false`}
    )`)
    .returning({ id: platformPayments.id, organizationId: platformPayments.organizationId });

  if (updated.length > 0) {
    alertPlatformAdmin('charge.dispute.created — PlatformPayment flagged disputed', {
      disputeId:        dispute.id,
      chargeId,
      paymentIntentId,
      platformPaymentId: updated[0].id,
      organizationId:    updated[0].organizationId,
    });
  }
}
