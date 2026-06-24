// Owner: Frank (refine stub; wire real Stripe integration)
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool.js';
import { grantCredits } from '../credits/service.js';
import type { PaymentProvider, CheckoutSession, CheckoutResult } from './provider.js';

// In-memory session store — stub only.
// Real flow: Frank's webhook looks up the bundle from Stripe's event metadata.
type SessionMeta = { bundleId: string; userId: string; credits: number };
const stubSessions = new Map<string, SessionMeta>();

export class StubPaymentProvider implements PaymentProvider {
  async createCheckoutSession(bundleId: string, userId: string): Promise<CheckoutSession> {
    // Verify bundle exists and get total credit amount (credits + bonus)
    const bundle = await pool.query(
      `SELECT id, label, credits, bonus_credits FROM credit_bundles WHERE id = $1`,
      [bundleId],
    );
    if (!bundle.rows[0]) throw new Error(`Bundle ${bundleId} not found`);

    const sessionId    = `stub_session_${uuidv4()}`;
    const totalCredits = (bundle.rows[0].credits as number) + (bundle.rows[0].bonus_credits as number);
    stubSessions.set(sessionId, { bundleId, userId, credits: totalCredits });

    return {
      sessionId,
      status:      'requires_completion',
      checkoutUrl: undefined, // real provider returns a redirect URL; stub skips
    };
  }

  async completeCheckoutSession(
    sessionId:      string,
    idempotencyKey: string,
    userId:         string,
  ): Promise<CheckoutResult> {
    const meta = stubSessions.get(sessionId);
    if (!meta) throw new Error(`Session '${sessionId}' not found — may have already been completed`);

    // Grant correct credits from the bundle (not a hardcoded amount)
    const result = await grantCredits(userId, meta.credits, 'purchase', idempotencyKey);

    // Clean up session after successful grant (idempotency key prevents re-grant on replay)
    stubSessions.delete(sessionId);

    return { creditBalance: result.newBalance };
  }
}
