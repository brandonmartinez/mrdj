// Owner: Frank — refund flow (Epic 4, #40, O7).
// Per O7 the money refund is DJ-initiated, within a policy window, and reverses the
// platform application fee proportionally (refund_application_fee). Outside the window
// (or when explicitly chosen) the remedy is an in-app credit return instead. Both paths
// are idempotent via the stable key `refund-<originalTxId>`, and strictly org-scoped.
import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import {
  db, platformPayments, creditTransactions, type DbExecutor,
} from '../db/index.js';
import { cfg } from '../config/index.js';
import { sendError } from '../http/middleware.js';
import { refundCredits } from '../credits/service.js';
import { getStripe } from './client.js';

export interface RefundOutcome {
  method:          'money' | 'credits';
  alreadyRefunded: boolean;
  fellBackToCredits: boolean;
  refundedCents?:  number;
  creditsReturned?: number;
  newBalance?:     number;
}

export class RefundRemedyConflictError extends Error {
  constructor(existingMethod: 'money' | 'credits') {
    super(`Payment already received a ${existingMethod} refund remedy`);
    this.name = 'RefundRemedyConflictError';
  }
}

/** Resolve the credit-grant transaction id for a payment (the `originalTxId`). */
async function findGrantTxId(stripePaymentIntentId: string, ex: DbExecutor): Promise<string | null> {
  const [row] = await ex
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(eq(creditTransactions.idempotencyKey, `purchase-${stripePaymentIntentId}`));
  return row?.id ?? null;
}

/**
 * Refund a PlatformPayment. `preferMoney` requests a Stripe card refund; if the policy
 * window has elapsed it transparently falls back to an in-app credit return. Returns
 * `null` when the payment does not exist in this org (caller maps to 404 — tenant isolation).
 */
export async function refundPayment(
  organizationId: string,
  paymentId:      string,
  preferMoney:    boolean,
): Promise<RefundOutcome | null> {
  return db.transaction(async (tx) => {
    const [pay] = await tx
      .select()
      .from(platformPayments)
      .where(and(eq(platformPayments.id, paymentId), eq(platformPayments.organizationId, organizationId)))
      .for('update');
    if (!pay) return null;

    const originalTxId = (await findGrantTxId(pay.stripePaymentIntentId, tx)) ?? pay.id;
    const refundKey    = `refund-${originalTxId}`;
    const withinWindow = Date.now() - pay.createdAt.getTime() <= cfg.refundWindowMs;

    if (pay.status === 'refunded') {
      const existingMethod = (pay.refundMethod ?? 'money') as 'money' | 'credits';
      const requestedMethod = preferMoney && withinWindow ? 'money' : 'credits';
      if (existingMethod !== requestedMethod) {
        throw new RefundRemedyConflictError(existingMethod);
      }
      return {
        method: existingMethod,
        alreadyRefunded: true,
        fellBackToCredits: preferMoney && !withinWindow && existingMethod === 'credits',
        refundedCents: existingMethod === 'money' ? pay.amountCents : undefined,
        creditsReturned: existingMethod === 'credits' ? pay.creditsGranted : undefined,
      };
    }

    if (preferMoney && withinWindow) {
      // Destination charge → reverse the application fee proportionally (O7).
      await getStripe().refunds.create(
        { payment_intent: pay.stripePaymentIntentId, refund_application_fee: true },
        { idempotencyKey: refundKey },
      );
      await tx.update(platformPayments)
        .set({ status: 'refunded', refundMethod: 'money', refundedAt: new Date() })
        .where(eq(platformPayments.id, pay.id));
      return { method: 'money', alreadyRefunded: false, fellBackToCredits: false, refundedCents: pay.amountCents };
    }

    // Credits-only remedy (append-only; idempotent on refundKey).
    const r = await refundCredits(
      pay.userId, organizationId, pay.creditsGranted, 'purchase_refund', refundKey, pay.id, undefined, tx,
    );
    await tx.update(platformPayments)
      .set({ status: 'refunded', refundMethod: 'credits', refundedAt: new Date() })
      .where(eq(platformPayments.id, pay.id));
    return {
      method: 'credits',
      alreadyRefunded: r.alreadyRefunded,
      fellBackToCredits: preferMoney && !withinWindow,
      creditsReturned: pay.creditsGranted,
      newBalance: r.newBalance,
    };
  });
}

/**
 * POST /api/orgs/:orgSlug/payments/:paymentId/refund  body: { method?: 'money'|'credits' }
 * Mounted behind resolveOrg + requireMembership('manager').
 */
export async function refundHandler(req: Request, res: Response) {
  const org = req.orgContext!;
  const { paymentId } = req.params;
  const { method } = req.body as { method?: 'money' | 'credits' };
  if (method && method !== 'money' && method !== 'credits') {
    sendError(res, 400, 'validation', "method must be 'money' or 'credits'");
    return;
  }
  let outcome: RefundOutcome | null;
  try {
    outcome = await refundPayment(org.id, paymentId, method !== 'credits');
  } catch (err) {
    if (err instanceof RefundRemedyConflictError) {
      sendError(res, 409, 'refund_already_remedied', err.message);
      return;
    }
    throw err;
  }
  if (!outcome) {
    sendError(res, 404, 'not_found', `Payment '${paymentId}' not found`);
    return;
  }
  res.json(outcome);
}
