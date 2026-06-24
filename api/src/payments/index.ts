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
// TODO(Basher): validate body, call CreditsService.grantCredits with idempotencyKey
// TODO(Frank): production path is a webhook — this endpoint is dev/stub only
export function checkoutCompleteStub(_req: Request, res: Response) {
  res.status(501).json({
    error: {
      code:    'validation',
      message: 'Not implemented — TODO(Basher/Frank): implement POST /checkout/stub-complete',
    },
  });
}
