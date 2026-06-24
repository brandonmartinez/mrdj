# Epic 4 Acceptance — Marketplace Payments / Stripe Connect

> Money-path epic (#8). Automated coverage lives in `api/src/__tests__/payments.test.ts`
> (30 tests, deterministic — a fake Stripe client is injected and webhook signatures are
> verified with real Stripe crypto against a test signing secret; no network, no live keys).
> This doc records the acceptance gates and the **manual test-mode E2E smoke (#63)** that
> exercises real Stripe sandbox calls before going live.

## Automated gates (CI — `npm test -w api`)
- **P-01** `applicationFeeCents` takes the platform fee (10%, rounded) — `#30/O11`.
- **P-02** Connect onboarding creates an Express account, stores `stripe_account_id`, returns an
  Account Link, and is **idempotent** (a second call reuses the account) — `#20/O10`.
- **P-03** `charges_enabled` guard returns **402** until KYC completes, then allows purchase — `#26/O14`.
- **P-04** Purchase creates a **destination charge** PaymentIntent with `application_fee_amount` and
  `transfer_data.destination` = the org's connected account; unknown/inactive bundle → 404 — `#30`.
- **P-05** Webhook signature is verified; bad/missing signature → **400** — `#23/#34/#37`.
- **P-06** `account.updated` mirrors `charges_enabled` / `payouts_enabled` — `#23`.
- **P-07** `payment_intent.succeeded` records a PlatformPayment and grants credits **exactly once**,
  even on duplicate event delivery or a second event for the same intent — `#34`.
- **P-08** `charge.dispute.created` flags the PlatformPayment `disputed` — `#37`.
- **P-09** Refund: money refund within the window reverses the application fee
  (`refund_application_fee:true`); out-of-window falls back to a credit return; duplicate is a
  no-op; another org's payment → **404** — `#40/O7`.
- **P-10** Per-org bundles CRUD + validation; another org's bundle is invisible (404) — `#43`.
- **P-11** Ledger: org earnings summary (`net = gross − fee`) + platform aggregate rollup — `#48`.
- **P-12** **Cross-org spend rejection (zero-tolerance):** credits granted at Org A are invisible at
  Org B (`organization_id`-scoped at the DB layer); a paid request at Org B funded only by Org A
  credits → **402**; concurrent paid requests never overdraw (balance `CHECK >= 0` + atomic
  decrement cap successes at the funded amount) — `#55/O8`.

## Manual test-mode E2E smoke (#63)

Run against **Stripe test mode** (keys `sk_test_…` / `pk_test_…`). Never use live keys locally.

### 1. Configure
```bash
# .env (api) — test-mode keys from https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
PLATFORM_FEE_PERCENT=10
PAYMENTS_CURRENCY=usd
STRIPE_CONNECT_REFRESH_URL=http://localhost:5173/connect/refresh
STRIPE_CONNECT_RETURN_URL=http://localhost:5173/connect/return
```

### 2. Forward webhooks with the Stripe CLI
```bash
# Install + login once: https://stripe.com/docs/stripe-cli
stripe login
# Forward events to the local API and copy the printed whsec_… into .env:
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# → Ready! Your webhook signing secret is whsec_…  (set STRIPE_WEBHOOK_SECRET, restart api)
```

### 3. Onboard a connected account (E-01)
```bash
# As an org owner/manager (authenticated cookie), start onboarding:
curl -sX POST localhost:3000/api/orgs/<slug>/stripe/connect -b cookie.txt | jq
# Open the returned `url`, complete the Stripe Express test form (use test SSN 000-00-0000,
# routing 110000000 / account 000123456789, any future date, etc.).
# `stripe listen` should deliver account.updated; status flips:
curl -s localhost:3000/api/orgs/<slug>/stripe/status -b cookie.txt | jq   # chargesEnabled:true
```

### 4. Guest purchase → credit grant (E-02)
```bash
# Create the PaymentIntent (returns clientSecret + publishableKey):
curl -sX POST localhost:3000/api/orgs/<slug>/credits/purchase \
  -H 'Content-Type: application/json' -b cookie.txt \
  -d '{"bundleId":"<bundleId>"}' | jq
# Confirm it in the web Payment Element (test card 4242 4242 4242 4242, any future exp/CVC),
# OR confirm via CLI for a smoke:
stripe payment_intents confirm <pi_id> --payment-method pm_card_visa
# `stripe listen` delivers payment_intent.succeeded → credits granted exactly once.
# Verify the ledger + balance:
curl -s localhost:3000/api/orgs/<slug>/payments -b cookie.txt | jq '.summary'
```

### 5. Refund (E-03)
```bash
# Money refund within the window reverses the proportional application fee:
curl -sX POST localhost:3000/api/orgs/<slug>/payments/<paymentId>/refund \
  -H 'Content-Type: application/json' -b cookie.txt -d '{"method":"money"}' | jq
# Confirm in the dashboard the refund + the application-fee reversal both posted.
```

### 6. Dispute (E-04)
```bash
# Trigger a test dispute on the charge (test card 4000000000000259 disputes automatically),
# or from the dashboard. `stripe listen` delivers charge.dispute.created → the PlatformPayment
# row flips to `disputed` and a [platform-alert] line is logged.
```

### Expected results
- **E-01** Connect Express onboarding completes; `charges_enabled` becomes true via webhook.
- **E-02** Destination charge lands on the connected account; the platform keeps the 10% fee;
  credits are granted once (idempotent across webhook retries).
- **E-03** Money refund reverses the charge **and** the application fee; ledger shows `refunded`.
- **E-04** Dispute flags the payment `disputed`; net earnings exclude it.

> **Do not commit any `sk_*` / `whsec_*` secret.** Test keys go in a local `.env` only.
