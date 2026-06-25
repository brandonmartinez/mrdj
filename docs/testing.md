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
- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed. On macOS:
  ```bash
  brew install stripe/stripe-cli/stripe
  stripe --version # verified with v1.43.2
  ```
- The app running locally through docker compose: `mrdj-app-1` serves the API on
  `http://localhost:3001` and web on `http://localhost:5173`; `mrdj-db-1` is Postgres on `:5432`.

### Configure test keys
Set these in the API environment (e.g. `.env`, see `.env.example`). The app reads env once at
process start, so restart it after editing `.env`:

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
```

The Stripe CLI can authenticate non-interactively with `--api-key`; no `stripe login` browser flow
is required. Get the stable signing secret before starting the app:

```bash
export SK=sk_test_…
stripe listen --api-key "$SK" --forward-to localhost:3001/api/webhooks/stripe --print-secret
# → whsec_…  # set STRIPE_WEBHOOK_SECRET to this value, then:
docker compose restart app
```

### Provision a test connected account (Custom)
The seeded demo org has no connected account, and hosted Express onboarding cannot be completed
headlessly. For this smoke, provision a **Custom** test connected account through the Stripe API.
For a destination charge, the connected account only needs the **transfers** capability active: the
platform charges the card, then Stripe transfers funds to the connected account. The connected
account's own `charges_enabled` / `card_payments` can remain false.

Use Stripe test-mode magic values so identity and bank details auto-verify. Use a real-looking HTTPS
URL you control or can plausibly use; Stripe rejects placeholder/example domains with `url_invalid`.
The commands below use `https://mrdj.app`; replace it with another real HTTPS business URL if needed.

```bash
curl -s https://api.stripe.com/v1/accounts -u "$SK:" \
  -d type=custom -d country=US \
  -d 'capabilities[card_payments][requested]=true' \
  -d 'capabilities[transfers][requested]=true' \
  -d business_type=individual \
  -d 'business_profile[url]=https://mrdj.app' \
  -d 'business_profile[mcc]=5734' \
  -d "tos_acceptance[date]=$(date +%s)" -d 'tos_acceptance[ip]=127.0.0.1' \
  -d 'individual[first_name]=Demo' -d 'individual[last_name]=Organizer' \
  -d 'individual[email]=demo-organizer@example.com' -d 'individual[phone]=0000000000' \
  -d 'individual[ssn_last_4]=0000' -d 'individual[id_number]=000000000' \
  -d 'individual[dob][day]=1' -d 'individual[dob][month]=1' -d 'individual[dob][year]=1990' \
  -d 'individual[address][line1]=address_full_match' -d 'individual[address][city]=South San Francisco' \
  -d 'individual[address][state]=CA' -d 'individual[address][postal_code]=94080' \
  -d 'external_account[object]=bank_account' -d 'external_account[country]=US' \
  -d 'external_account[currency]=usd' -d 'external_account[routing_number]=110000000' \
  -d 'external_account[account_number]=000123456789'
# → acct_… with capabilities.transfers=active
```

Attach the returned account to the org under test. In real onboarding, `account.updated` mirrors
these booleans; for this smoke set them directly so `requireChargesEnabled` passes:

```bash
docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
  "UPDATE organizations SET stripe_account_id='acct_…', charges_enabled=true, payouts_enabled=true WHERE slug='demo';"
```

### Start the webhook relay
The CLI forwards Stripe's test webhooks to the local raw-body endpoint. Use the same `--api-key`
for non-interactive auth:

```bash
stripe listen --api-key "$SK" --forward-to localhost:3001/api/webhooks/stripe
# → Ready! Your webhook signing secret is whsec_…
# → --> payment_intent.succeeded [evt_…]
```

### Run the flow

1. **Create a guest session and capture the purchasing user id.**
   ```bash
   curl -s -c cookies.txt -b cookies.txt http://localhost:3001/api/me | jq
   # → { user: { id: "…" }, creditBalance: 0, ... }
   ```

2. **Discover a purchasable bundle.** Use the public guest endpoint, not the staff CRUD endpoint.
   ```bash
   curl -s -c cookies.txt -b cookies.txt http://localhost:3001/api/credits/bundles | jq
   # verified with Starter Pack bundle …0040: 5 credits, 500¢
   ```

3. **Create the PaymentIntent** for the org under test.
   ```bash
   curl -s -X POST http://localhost:3001/api/orgs/demo/credits/purchase \
     -H 'Content-Type: application/json' -c cookies.txt -b cookies.txt \
     -d '{"bundleId":"…0040","clientRequestId":"smoke-1"}' | jq
   # → { clientSecret, paymentIntentId, publishableKey, amountCents: 500,
   #     applicationFeeCents: 50, credits: 5 }
   ```

4. **Confirm headlessly with a test card.** This is the reproducible primary path; no browser or
   Payment Element is required.
   ```bash
   PI=pi_…
   curl -s "https://api.stripe.com/v1/payment_intents/$PI/confirm" -u "$SK:" \
     -d payment_method=pm_card_visa -d 'return_url=https://mrdj.app/return' | jq
   # → status=succeeded, amount_received=500, transfer_data.destination=acct_…
   ```
   Browser alternative: use the Payment Element with Stripe's success card
   **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP.

5. **Observe the webhook.** The `stripe listen` terminal shows `payment_intent.succeeded`
   forwarded and the API logs the grant. The handler (`api/src/payments/webhooks.ts`) inserts a
   `platform_payments` ledger row (`onConflictDoNothing` on `stripe_payment_intent_id`) and grants
   `creditsGranted` credits inside one transaction.

6. **Assert the grant + balance.** Credits live in the `wallets` table per
   `(user_id, organization_id)` (O8 org-scoped). The app surfaces a user's balance via
   `GET /api/me` (`creditBalance`); assert directly against the DB for certainty:
   ```bash
   docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
     "select stripe_payment_intent_id, credits_granted, status from platform_payments order by created_at desc limit 3;"
   docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
     "select w.balance from wallets w join organizations o on o.id = w.organization_id where o.slug = 'demo' order by w.updated_at desc limit 1;"
   docker exec -i mrdj-db-1 psql -U mrdj -d mrdj -c \
     "select reason, amount, idempotency_key from credit_transactions order by created_at desc limit 3;"
   ```

### Idempotency replay (must grant exactly once)
Re-deliver the same event and confirm the balance does **not** change:

```bash
stripe events resend <evt_payment_intent_succeeded> --api-key "$SK"
# Re-check balance — unchanged. processed_webhook_events fast-path returns 200 {duplicate:true};
# UNIQUE(stripe_payment_intent_id) + onConflictDoNothing also protects the ledger grant.
```

### Pass criteria
- [x] PaymentIntent created with the platform `application_fee_amount` and
      `transfer_data.destination` = the org's connected account.
- [x] Test card confirms; `payment_intent.succeeded` received with our metadata.
- [x] Exactly one `platform_payments` row; wallet balance increased by `creditsGranted`.
- [x] Re-delivering the event grants **no** additional credits.

### Verified 2026-06-25
Full Stripe test-mode smoke + idempotency replay passed live: PaymentIntent
`pi_3TmFQiLoYlZD0bd22Y00iPMT` succeeded for 500¢ / 5 credits, wallet balance moved 0→5, and
`stripe events resend` was a no-op duplicate (still exactly one `platform_payments` row and one
`credit_transactions` purchase grant).

> **MONEY-PATH:** transactional, idempotent, `organization_id`-scoped, no double-grant. Rusty
> review required before this is signed off for go-live.
