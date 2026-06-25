import { useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Cache Stripe.js loaders by publishable key so we don't re-download the SDK per modal open.
const stripeByKey = new Map<string, Promise<Stripe | null>>();
function getStripe(publishableKey: string): Promise<Stripe | null> {
  let p = stripeByKey.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripeByKey.set(publishableKey, p);
  }
  return p;
}

interface StripeCheckoutProps {
  clientSecret:   string;
  publishableKey: string;
  amountLabel:    string;
  onPaid:         () => void;
  onCancel:       () => void;
}

/** Stripe Payment Element checkout for a Connect destination charge (Epic 7, #86). */
export function StripeCheckout({ clientSecret, publishableKey, amountLabel, onPaid, onCancel }: StripeCheckoutProps) {
  return (
    <Elements
      stripe={getStripe(publishableKey)}
      options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#7c3aed' } } }}
    >
      <CheckoutForm amountLabel={amountLabel} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function CheckoutForm({ amountLabel, onPaid, onCancel }: { amountLabel: string; onPaid: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    // No redirect: confirm in-place and let the webhook grant credits server-side.
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) {
      setError(error.message ?? 'Payment failed. Please try another card.');
      setBusy(false);
      return;
    }
    onPaid();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || busy}
          className="flex-1 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
        >
          {busy ? 'Processing…' : `Pay ${amountLabel}`}
        </button>
      </div>
    </form>
  );
}
