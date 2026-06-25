# Testing guide

Two layers of payment testing exist:

1. **Automated logic coverage** (runs in CI, no Stripe account) — `api/src/__tests__/payments.test.ts`.
2. **Manual Stripe test-mode end-to-end smoke** (#63) — requires real Stripe **test** keys + the
   Stripe CLI; documented below. This is the go-live verification the owner runs once against a
   real (test-mode) Stripe account before opening payments.

---

## 1. Automated coverage (already green)

`npm test -w api` exercises the full money path with a **fake Stripe** (no network):

| Concern | Test |
|---------|------|
| Platform application fee (10%, banker-rounded) | `applicationFeeCents (#30/O11)` |
| Connect Express onboarding + idempotent reuse + membership guard | `Connect Express onboarding (#20/O10)` |
| `charges_enabled` KYC gate (402 until onboarded) | `charges_enabled guard (#26/O14)` |
| Guest purchase → PaymentIntent with destination charge + app fee | `Guest purchase → PaymentIntent (#30)` |
| Webhook signature rejection (bad / missing signature → 400) | `Stripe webhooks (#23/#34/#37)` |
| **`payment_intent.succeeded` grants credits exactly once on replay** | `#34 … grants credits exactly once (idempotent on replay)` |
| Dispute flips ledger row to `disputed` | `#37 charge.dispute.created …` |
| Non-marketplace PaymentIntent ignored | `ignores a PaymentIntent without marketplace metadata` |
| Refund within window reverses app fee; idempotent; credit-return fallback | `Refunds (#40/O7)` |
| Tenant isolation (no cross-org spend / refund) | `Cross-org credit spend rejection (#55)` |

So the **idempotency, signature verification, fee math, grant, and tenant scoping are
verified in CI.** What the manual smoke below adds is confidence that the *wiring against the
real Stripe API* (PaymentIntent creation, test-card confirmation, live webhook signature from
Stripe's servers) works end-to-end.

---

## 2. Stripe test-mode end-to-end smoke (#63)

> **Test mode only — no real money.** Use keys that start with `sk_test_` / `pk_test_`.

### Prerequisites
- A Stripe account in **test mode** with **Connect** enabled.
- A connected (Express) test account for the org under test that has completed onboarding so
  `charges_enabled` is true. (Use the app's onboarding flow, or Stripe's test onboarding.)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed and `stripe login` completed.
- The app running locally (`docker compose up` or `npm run dev`) on `http://localhost:3001`.

### Configure test keys
Set these in the API environment (e.g. `.env`, see `.env.example`):

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
# STRIPE_WEBHOOK_SECRET is printed by `stripe listen` below — paste it in, then restart the API.
```

### Start the webhook relay
The CLI forwards Stripe's test webhooks to the local raw-body endpoint and prints the signing
secret:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
# → Ready! Your webhook signing secret is whsec_…  ← put this in STRIPE_WEBHOOK_SECRET, restart API
```

### Run the flow

1. **Discover a bundle**
   ```bash
   curl -s http://localhost:3001/api/credits/bundles | jq
   ```

2. **Create the PaymentIntent** (guest purchase; `:orgSlug` is the org under test). The route is
   behind `resolveOrg` + `requireChargesEnabled`, so authenticate as a guest with a session
   cookie first.
   ```bash
   curl -s -X POST http://localhost:3001/api/orgs/<orgSlug>/credits/purchase \
     -H 'Content-Type: application/json' -b cookies.txt \
     -d '{"bundleId":"<bundleId>","clientRequestId":"smoke-1"}' | jq
   # → { clientSecret, paymentIntentId, publishableKey, amountCents, applicationFeeCents, credits }
   ```

3. **Confirm with a test card.** In the browser (the Payment Element) use Stripe's success card
   **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP. (Headless alternative: confirm the
   PaymentIntent via the Stripe CLI/SDK with test PM `pm_card_visa`.)

4. **Observe the webhook.** The `stripe listen` terminal shows `payment_intent.succeeded`
   forwarded and the API logs the grant. The handler (`api/src/payments/webhooks.ts`) inserts a
   `platform_payments` ledger row (`onConflictDoNothing` on `stripe_payment_intent_id`) and grants
   `creditsGranted` credits inside one transaction.

5. **Assert the grant + balance.** Credits live in the `wallets` table per
   `(user_id, organization_id)` (O8 org-scoped). The app surfaces a user's balance via
   `GET /api/me` (`creditBalance`); assert directly against the DB for certainty:
   ```bash
   # ledger shows the payment
   docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
     "select stripe_payment_intent_id, credits_granted, status from platform_payments order by created_at desc limit 3;"
   # wallet balance for the purchasing user in this org reflects creditsGranted
   docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
     "select w.balance from wallets w join organizations o on o.id = w.organization_id where o.slug = '<orgSlug>' order by w.updated_at desc limit 1;"
   ```

### Idempotency replay (must grant exactly once)
Re-deliver the same event and confirm the balance does **not** change:

```bash
stripe events resend <evt_id_from_listen_output>
# Re-check balance — unchanged. The UNIQUE(stripe_payment_intent_id) + onConflictDoNothing
# in handlePaymentIntentSucceeded guarantees a single grant. (Also covered by the #34 unit test.)
```

### Pass criteria
- [ ] PaymentIntent created with the platform `application_fee_amount` and
      `transfer_data.destination` = the org's connected account.
- [ ] Test card confirms; `payment_intent.succeeded` received with our metadata.
- [ ] Exactly one `platform_payments` row; wallet balance increased by `creditsGranted`.
- [ ] Re-delivering the event grants **no** additional credits.

> **MONEY-PATH:** transactional, idempotent, `organization_id`-scoped, no double-grant. Rusty
> review required before this is signed off for go-live.
