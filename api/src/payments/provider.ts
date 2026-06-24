// Owner: Frank (real implementation — replace stub with Stripe/etc.)
// PaymentProvider abstraction: stub checkout mimics production shape so Frank
// can swap in Stripe without changing callers.

/** Thrown when a payment operation is attempted without required configuration. */
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConfigError';
  }
}

export interface CheckoutSession {
  sessionId: string;
  status:    'requires_completion';
  /** URL to redirect guest to complete checkout (real provider only) */
  checkoutUrl?: string;
}

export interface CheckoutResult {
  creditBalance: number;
}

export interface PaymentProvider {
  /**
   * Create a checkout session for a credit bundle purchase.
   * Production: creates Stripe PaymentIntent / Session.
   * Stub: returns a session ID immediately.
   */
  createCheckoutSession(bundleId: string, userId: string): Promise<CheckoutSession>;

  /**
   * Complete a checkout session (stub only — real flow uses webhooks).
   * Production: verified via Stripe webhook, not a direct call.
   * Stub: grants credits directly via CreditsService.
   */
  completeCheckoutSession(sessionId: string, idempotencyKey: string, userId: string): Promise<CheckoutResult>;
}
