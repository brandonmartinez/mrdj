// Owner: Frank (refine stub; wire real Stripe integration)
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool.js';
import { grantCredits } from '../credits/service.js';
import type { PaymentProvider, CheckoutSession, CheckoutResult } from './provider.js';

export class StubPaymentProvider implements PaymentProvider {
  async createCheckoutSession(bundleId: string, _userId: string): Promise<CheckoutSession> {
    // Verify bundle exists
    const bundle = await pool.query(
      `SELECT id, label, credits, bonus_credits FROM credit_bundles WHERE id = $1`,
      [bundleId],
    );
    if (!bundle.rows[0]) throw new Error(`Bundle ${bundleId} not found`);

    return {
      sessionId:   `stub_session_${uuidv4()}`,
      status:      'requires_completion',
      checkoutUrl: undefined, // real provider returns a URL; stub skips
    };
  }

  async completeCheckoutSession(
    sessionId:      string,
    idempotencyKey: string,
    userId:         string,
  ): Promise<CheckoutResult> {
    // TODO(Frank): in production this path is a webhook, not a direct call.
    // Stub: extract bundleId from sessionId metadata (real: from provider event),
    // then grant credits via CreditsService.
    // For now the stub grants a fixed 5 credits as a placeholder.
    const result = await grantCredits(userId, 5, 'purchase', idempotencyKey);
    return { creditBalance: result.newBalance };
  }
}
