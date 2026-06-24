# Payment Provider Evaluation — Decision O1

> **Summary:** After evaluating Stripe, PayPal, Amazon Pay, and other contenders against mrdj's
> credits/wallet model requirements, **Stripe** is the recommended payment provider. It offers the
> best combination of hosted PCI-compliant checkout, robust webhook infrastructure, idempotency
> support, and clean SDK integration for Node.js — all critical for our server-authoritative,
> mobile-first, credits-based architecture.

---

## Context

mrdj is a Jukebox-style social jukebox where guests purchase credits with real money and spend
them on queue actions (Up Next bump, premium Play Next). Per `docs/REQUIREMENTS.md` §6 and the
project charter, our payment integration must satisfy these **hard requirements**:

1. **Raw card data never touches our servers** — hosted fields / hosted checkout only (PCI SAQ-A scope)
2. **Purchases verified via webhook** before credits are granted — server-authoritative
3. **Idempotency** on every purchase — safe under retries and replays
4. **Designed for refunds and chargebacks/disputes** from day one
5. **Mobile-first checkout UX** — guests are on phones in a dark room, often anonymous
6. **Credits/wallet model** — buy credits once, spend multiple times (better upsell, lower per-action fees)

This evaluation compares **Stripe**, **PayPal**, and **Amazon Pay** across these axes, with brief
notes on other contenders (Adyen, Braintree, Square).

---

## Tradeoff Table

| Axis | Stripe | PayPal | Amazon Pay |
|------|--------|--------|------------|
| **Transaction Fees (US)** | ~2.9% + $0.30 per txn; volume discounts available | ~2.9% + $0.49 per txn (advanced checkout); micropayments rate exists (~5% + $0.05) but availability varies | ~2.9% + $0.30 per txn; limited volume flexibility |
| **Small-Value Credit-Pack Fit** | Good — custom amounts; standard fee bites on <$5 packs but manageable with pack sizing | Decent — micropayments rate helps small values if enabled; standard rate painful on $2–$3 packs | Weak — standard rate; no micropayment tier; minimum purchase friction |
| **Credits/Wallet Model Fit** | Excellent — no opinions on what you sell; Customer/PaymentMethod model lets users save cards for quick re-buy; Payment Intents are atomic | Fair — PayPal wallets are their own stored-value layer; you're layering our wallet on top; no friction but conceptual overlap | Poor — designed for one-time purchases; storing payment methods requires Pay session re-auth; doesn't encourage repeat low-friction buys |
| **Hosted Checkout / PCI Scope** | ✅ Payment Element / Checkout (hosted fields, SAQ-A); raw card data never hits our servers | ✅ Hosted checkout / JS SDK; SAQ-A eligible if used correctly | ✅ Hosted button/checkout; SAQ-A; but UX is redirect-heavy |
| **Mobile-First UX** | ✅ Payment Sheet, Link (one-tap), Apple Pay, Google Pay all native and tight | ⚠️ Redirect to PayPal app/browser; app installed = decent; no app = friction | ⚠️ Redirect to Amazon; requires Amazon account; niche for mobile guests |
| **Apple Pay / Google Pay** | ✅ First-class; Payment Request API integration, minimal config | ⚠️ Supported via Braintree (PayPal owns it), but PayPal SDK pushes PayPal-first | ⚠️ Limited; Amazon Pay is an alternative *to* these wallets, not a host of them |
| **Webhooks + Event Reliability** | ✅ Best-in-class; signed webhooks, event replay, Stripe CLI for local testing | ⚠️ IPNs exist but less structured; newer REST webhooks improving; historically less reliable | ⚠️ IPNs; less rich event model; harder to test locally |
| **Idempotency Support** | ✅ Native `Idempotency-Key` header on all mutating requests; replays safe | ⚠️ No native idempotency header; requires application-level dedup (e.g., invoice IDs) | ⚠️ No native idempotency header; client-generated order IDs help but not guaranteed safe |
| **Dispute / Chargeback Tooling** | ✅ Dashboard, API for disputes; evidence upload; Radar for fraud | ✅ Robust — PayPal's Seller Protection; dispute flow familiar to users | ⚠️ A-to-Z Guarantee is powerful but favors buyers; less seller tooling |
| **Payout / Settlement** | Rolling 2-day payout by default; Instant Payouts available (fee); Connect for marketplace/multi-party | Rolling 1–3 day; PayPal balance complicates if you want funds in bank | Rolling 1–5 days to linked bank; no instant option |
| **Node.js SDK & Docs** | ✅ Excellent; `stripe-node` official, well-typed, active; docs industry-leading | ⚠️ SDKs exist but less polished; REST API solid; docs fragmented across products | ⚠️ SDK exists; docs less extensive; fewer community examples |
| **Sandbox / Testing** | ✅ Test mode built-in; Stripe CLI for webhook testing; test cards/scenarios | ⚠️ Sandbox exists but setup heavier; webhook testing less smooth | ⚠️ Sandbox available; less tooling; fewer test scenarios documented |

**Legend:** ✅ strong fit — ⚠️ workable with caveats — ❌ poor fit

---

## Per-Provider Notes

### Stripe

**Strengths:**
- **Payment Intents API** is purpose-built for exactly our flow: create an intent, collect payment
  via hosted UI (Payment Element), confirm server-side, listen for `payment_intent.succeeded` webhook,
  then grant credits atomically.
- **Idempotency-Key** header means our retry logic is safe by design — no double-charges.
- **Customer + PaymentMethod** model lets returning guests (account holders) re-buy credits with one
  tap, no re-entering card details.
- **Apple Pay + Google Pay + Link** are first-class — ideal for mobile-first guests.
- **Webhooks** are signed, replayable, and testable locally via `stripe listen` CLI.
- **Radar** fraud detection is integrated.
- **Connect** available if we ever need marketplace splits (e.g., DJ revenue share) — YAGNI for MVP, but headroom.
- Node.js SDK (`stripe-node`) is excellent, fully typed, and actively maintained. Docs are industry-leading.

**Weaknesses:**
- Standard 2.9% + $0.30 hurts on very small transactions (<$3); mitigated by selling credit *packs*
  ($5, $10, $20) rather than micro amounts. *(This informs O2 — see Open Follow-ups.)*
- Stripe is US/EU-centric; emerging markets have other options — but mrdj MVP is US-targeted.

**PCI Scope:** Using Payment Element keeps us at **SAQ-A** — raw card data never touches our backend.

### PayPal

**Strengths:**
- Brand recognition; many users already have PayPal accounts, reducing friction for some demographics.
- PayPal Balance / Venmo integration could be appealing to younger users.
- Seller Protection for disputes is mature.
- Owns Braintree (a strong tech platform) if we wanted to use Braintree SDK under the hood.

**Weaknesses:**
- **Redirect-based checkout** disrupts mobile flow — users leave our app, auth in PayPal app or browser, return.
  In a dark room on a phone, this is friction.
- No native **idempotency header**; we'd have to rely on `invoice_id` dedup and application-level logic.
- **Webhook/IPN reliability** has historically been less predictable; newer REST webhooks are better but still not
  as smooth as Stripe's.
- **Conceptual overlap:** PayPal is itself a wallet — layering our credits wallet on top of theirs is workable
  but slightly awkward messaging.
- SDK and docs are fragmented across PayPal Checkout, Braintree, and legacy integrations.

**PCI Scope:** Hosted checkout keeps us SAQ-A if done correctly.

### Amazon Pay

**Strengths:**
- Trusted brand; one-click for Prime users.
- A-to-Z Guarantee gives buyers confidence.

**Weaknesses:**
- **Requires an Amazon account** — a barrier for guests who don't have one or don't want to link it.
- **Redirect-heavy UX** — not mobile-first.
- **Credits/wallet model is awkward:** Amazon Pay is designed for product checkout, not stored-value.
  Re-authentication for repeat purchases adds friction.
- **No native idempotency header**; weaker webhook tooling.
- **Apple Pay / Google Pay not supported** — Amazon Pay *is* the wallet, not a host of other wallets.
- Smaller developer community; fewer Node.js examples and community support.
- A-to-Z disputes favor buyers, less tooling for sellers.

**PCI Scope:** Hosted checkout keeps us SAQ-A.

### Other Contenders (Brief)

| Provider | Notes |
|----------|-------|
| **Braintree** | Owned by PayPal. Strong tech (Drop-in UI, vault, Apple/Google Pay). Could be considered if PayPal is strategic — but inherits some PayPal complexity. SDK quality is good. Fees similar to Stripe. |
| **Adyen** | Enterprise-grade; unified platform; fees competitive at volume. Overkill for MVP; onboarding is heavier; better suited for large scale. |
| **Square** | Good for in-person POS; web/mobile SDK improving but less mature than Stripe. Fees similar. Not a clear win for our web-first, credits model. |

None of these offer a compelling advantage over Stripe for our MVP requirements. **Braintree** is the
closest alternative if PayPal strategic alignment were needed, but it doesn't beat Stripe on developer
experience or idempotency.

---

## Recommendation

### ✅ STRIPE

**Rationale:**

1. **Idempotency-Key header** is native — our server-authoritative, retry-safe credit grant flow
   (`payment_intent.succeeded` webhook → grant credits atomically) is safe by design. This is a hard
   requirement from §6 of REQUIREMENTS.md.

2. **Payment Element + Link + Apple Pay + Google Pay** delivers the mobile-first, no-redirect checkout
   UX guests need in a dark room. One-tap repeat purchases for account holders via saved PaymentMethods.

3. **Webhooks** are signed, structured, replayable, and testable locally (`stripe listen`). We can
   develop and test the entire purchase → verify → grant flow without deploying to prod.

4. **Credits/wallet model** is natural — Stripe doesn't opine on what we sell. We create Payment Intents
   for credit packs; our backend is the source of truth for credit balances.

5. **PCI SAQ-A scope** — raw card data never hits our servers. Payment Element handles collection;
   we only see tokens and events.

6. **Node.js SDK** (`stripe-node`) is first-class, fully typed, actively maintained, and widely used.
   Docs are industry-leading. This accelerates build and reduces integration risk.

7. **Dispute tooling and Radar fraud detection** are mature — important for real-money handling.

8. **Future headroom:** Stripe Connect exists if we ever need DJ revenue splits (marketplace model),
   though this is YAGNI for MVP.

**Trade-off acknowledged:** Stripe's 2.9% + $0.30 fee bites on very small transactions. We mitigate
this by selling **credit packs** ($5, $10, $20) rather than micro-purchases. This aligns with the
credits-first upsell model and amortizes fixed fees.

---

## Open Follow-ups

These items remain open or need follow-up work:

| Item | Notes |
|------|-------|
| **Credit-pack pricing & fee modeling** | Model transaction fees vs pack sizes to find sweet spots ($5, $10, $20). Feeds into O2 (normal request cost) — if requests cost credits, pack sizing matters more. |
| **Refund policy** | Define guest-facing refund policy (unused credits only? time window?). Stripe refunds are straightforward; build the policy. |
| **Chargeback/dispute handling runbook** | Document how we respond to disputes, what evidence to upload, and how we protect against friendly fraud. |
| **Apple Pay & Google Pay enablement** | Register domains and verify with Apple/Google via Stripe Dashboard. Low effort but must be done. |
| **Stripe account setup** | Create Stripe account, configure webhooks, obtain API keys. Virgil will manage secrets (env/configMap/secret per D2). |
| **Connect (marketplace) — YAGNI** | If DJ revenue share is ever needed, evaluate Stripe Connect. Not MVP. |

---

## Implications for O2 (Normal Request Cost)

O2 asks whether a normal request is **free** or **low-cost**.

The Stripe fee structure slightly favors **free requests** for MVP, with credits spent only on bumps:
- If requests cost credits (e.g., 1 credit = $0.10), guests buy smaller packs more often, and the $0.30
  fixed fee per transaction hurts margins.
- If requests are free and only bumps cost credits, guests buy larger packs less frequently, amortizing fees.

However, this is a product decision (abuse control, conversion, engagement) — O2 stays open. The payment
provider choice doesn't force either answer; Stripe handles both models fine.

---

## Summary

| Axis | Winner |
|------|--------|
| Transaction fees (small packs) | PayPal micropayments *if* enabled; else Stripe ≈ others |
| Credits/wallet model fit | **Stripe** (no opinions, atomic intents) |
| Mobile-first checkout UX | **Stripe** (Payment Element, Link, Apple/Google Pay) |
| PCI scope (hosted, no raw card data) | All three meet this; Stripe's DX is cleanest |
| Webhooks + idempotency | **Stripe** (native, best-in-class) |
| Dispute/chargeback tooling | Stripe ≈ PayPal; both strong |
| Payout / settlement | Stripe ≈ PayPal; both 1–3 days |
| Node.js SDK & docs | **Stripe** (industry-leading) |

**Decision:** Use **Stripe** for mrdj payments.

---

*Document authored 2026-06-23 by Frank (Payments Engineer). Decision O1 remains OPEN pending the project owner's approval.*
