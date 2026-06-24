// Owner: Frank — shared Stripe client (Epic 4).
// A single lazily-constructed Stripe SDK instance is reused across the Connect,
// purchase, webhook, and refund flows. The Stripe Node SDK issues requests over
// Node's https module, so nock intercepts them in tests without any network — see
// __tests__/payments.test.ts. Tests may also inject a fake via setStripe().
import Stripe from 'stripe';
import { cfg } from '../config/index.js';
import { PaymentConfigError } from './provider.js';

let stripeSingleton: Stripe | null = null;

/**
 * Resolve the shared Stripe client. Fail-fast (PaymentConfigError) when no secret
 * key is configured so a misconfigured deploy surfaces immediately rather than at
 * the first card charge. Retries are disabled for deterministic test replay; the
 * SDK's pinned API version is used (kept current with the installed SDK).
 */
export function getStripe(): Stripe {
  if (stripeSingleton) return stripeSingleton;
  if (!cfg.stripeSecretKey) {
    throw new PaymentConfigError('STRIPE_SECRET_KEY is not configured');
  }
  stripeSingleton = new Stripe(cfg.stripeSecretKey, {
    maxNetworkRetries:  0,
    telemetry:          false,
  });
  return stripeSingleton;
}

/** Inject a Stripe client (tests). Pass null to reset to lazy default. */
export function setStripe(client: Stripe | null): void {
  stripeSingleton = client;
}
