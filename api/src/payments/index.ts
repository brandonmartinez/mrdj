// Owner: Frank (checkout routes) | Basher (stub-complete with credit grant)
import type { Request, Response } from 'express';
import { StubPaymentProvider } from './stub.js';
import { sendError } from '../http/middleware.js';

const paymentProvider = new StubPaymentProvider();

// ── POST /api/checkout/session ────────────────────────────────────────────────
export async function checkoutSessionStub(req: Request, res: Response) {
  const { bundleId } = req.body as { bundleId?: string };
  if (!bundleId) {
    sendError(res, 400, 'validation', 'bundleId is required');
    return;
  }
  try {
    const session = await paymentProvider.createCheckoutSession(bundleId, req.session.userId!);
    res.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendError(res, 400, 'validation', message);
  }
}

// ── POST /api/checkout/stub-complete ─────────────────────────────────────────
// Resolves the stub session's bundle, grants credits via CreditsService (idempotent),
// and returns the updated balance.
// NOTE: In production, Frank's Stripe webhook owns credit grants — this path is stub/dev only.
// The idempotencyKey prevents double-grants on retry; raw payment data never enters app logic.
export async function checkoutCompleteHandler(req: Request, res: Response) {
  const { sessionId, idempotencyKey } = req.body as {
    sessionId?: string;
    idempotencyKey?: string;
  };

  if (!sessionId || !idempotencyKey) {
    sendError(res, 400, 'validation', 'sessionId and idempotencyKey are required');
    return;
  }

  try {
    const result = await paymentProvider.completeCheckoutSession(
      sessionId,
      idempotencyKey,
      req.session.userId!,
    );
    res.json({ creditBalance: result.creditBalance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    sendError(res, 400, 'validation', message);
  }
}
