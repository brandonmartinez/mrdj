# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: First major deliverable is Open Decision O1 — the payment provider recommendation. Evaluate Stripe, PayPal, Amazon Pay (and note others) against: fees, credits/wallet support, mobile checkout UX, payout, dispute/chargeback handling, integration effort. Deliver a tradeoff table + a clear pick.
- 2026-06-23: Credits-first model (like Pay-to-Play gaming). Guests buy credits; bump and Play Next debit credits. Grant credits only after webhook verification; idempotency keys on every purchase. Raw card data stays with the provider.

## 2026-06-23 Loop Round 1 — O1 Stripe Recommendation + O7 Refund Policy Framing

**Loop workstream:** Payment provider (O1), Refund policy (O7).

**O1 — Payment provider (YOUR OWNERSHIP):**
- **Recommendation:** Stripe. Rationale:
  - Native idempotency headers (critical for retry-safe, server-authoritative credit grant flow)
  - Best-in-class webhooks for payment events (grant/refund triggers)
  - Mobile-first Payment Element (Apple Pay/Google Pay built-in, no additional UX work)
  - Excellent Node.js SDK (stripe npm package well-maintained)
  - PCI SAQ-A scope (we never touch raw card data, hosted checkout)
  - Credits/wallet model maps cleanly to Payment Intents (no conceptual friction)
  - Transaction fees: 2.9% + $0.30 per transaction (manageable with credit-pack sizing $5/$10/$20)
  - Dispute/chargeback handling + webhook for O7 (refund policy)
- **Doc:** docs/decisions/payments-provider.md (comprehensive tradeoff table vs PayPal, Amazon Pay, etc.)
- **Status:** ✅ O1 PROPOSED — pending the project owner confirmation.

**Follow-ups (post-O1 confirmation):**
1. **O7 — Refund / dispute policy (CO-OWNED WITH SAUL):**
   - Rai identified critical policy gap: no guidance on when/how refunds are granted.
   - **Your responsibilities:**
     - Policy wording (clear, generous to reduce chargebacks)
     - Webhook handler for Stripe `charge.dispute.created` (flag account for admin review)
     - Refund request process (email to support@mrdj.app or in-app later?)
     - Refund destination (credit balance vs original payment method?)
     - Promo credits handling (if we add them — not refundable, recommendation)
   - **Related to:** O2 (pricing impacts refund/chargeback rates), Basher (admin refund triggers on DJ skip), Linus (UI disclosure at checkout/FAQ).
   - **Status:** OPEN — awaiting the project owner/your decision.

2. **O2 — Normal request cost (CO-OWNED WITH SAUL):**
   - Architecture supports free or low-cost; pricing config drives spend call.
   - Your input: fee model (micro-transactions? set cost per request?). Ties to O7 (refund likelihood).

3. **Credit-pack fee modeling:**
   - Determine credit-pack sizes ($5, $10, $20) and bonus tiers (if any).
   - Input to Linus (UI disclosure pre-checkout), Rai (dark-pattern avoidance).
   - Goal: balance revenue + perceived fairness.

4. **Apple/Google Pay domain registration:**
   - Stripe Payment Element handles Apple/Google Pay UX, but we need domain verification.
   - Coordinate with Basher/DevOps on domain setup pre-launch.

**CreditsService contract (YOUR DEPEND-SIDE):**
- You call `grantCredits(accountId, amount, "stripe_webhook", transactionId, idempotencyKey)` on successful Stripe payment.
- Basher's spend-side calls `spendCredits(accountId, amount, "queue_action", queueItemId, idempotencyKey)` for paid requests.
- Idempotent, append-only ledger. Your responsibility: webhook parsing, grant calls, transaction logging.

**Status:** O1 ready for the project owner confirmation. O7 open; ready to draft policy spec once confirmed. No code yet; timely to finalize policies pre-integration.

## 2026-06-23 — Maker≠Checker Audit of Basher's Slice-01 Money Paths

**Commit:** `d7dc263`

**Scope audited:** `createRequestHandler`, `checkoutCompleteHandler`, `adminGrantHandler`, `advanceQueue` — plus migration schema, credits service, and stub payment provider.

**Checklist results (1–8):**
1. ✅ **Atomicity** — All paid paths use explicit BEGIN/COMMIT/ROLLBACK; queue insert + debit + slot update are all-or-nothing.
2. ✅ **Server-authoritative pricing** — Costs from `pricing_config`; no request-body amount accepted for debits. Admin grant is admin-gated.
3. ⚠️→✅ **Idempotency** — UNIQUE enforced; normal replay path correct. **BUG-1 fixed:** concurrent boost/queue requests with the same key both passed the SELECT idempotency check before either committed, then raced on INSERT, causing a 23505 → 500 instead of returning the prior result.
4. ✅ **Failed action ⇒ zero ledger rows** — Both 402 and 409 exit paths ROLLBACK before any writes.
5. ✅ **Play Next single-slot** — FOR UPDATE serialises concurrent purchases; second buyer gets 409; advance resets to available, no refund (D6).
6. ✅ **Ledger integrity** — Append-only; balance derived from wallet; admin grant writes actor_id + admin_grant reason.
7. ✅ **PgBouncer-safe** — No named prepared statements, no session state; all queries parameterised.
8. ✅ **Error contract** — 402 `insufficient_credits` with required+balance; 409 `play_next_unavailable`; 403 from requireAdmin middleware.

**Fixes shipped:**
- `api/src/queue/index.ts` — catch block: recover from Postgres 23505 (unique_violation on idempotency_key) by returning prior result rather than 500. (BUG-1)
- `api/src/payments/stub.ts` — `completeCheckoutSession`: when session not found, check DB for idempotency key before throwing; return prior balance on match. (BUG-2)
- `api/src/__tests__/money.test.ts` — added Frank-BUG1 (concurrent boost) + MC-10 replay tests.

**Risk note (no code, deferred):** Concurrent distinct-key spends at min wallet balance → DB check_violation (23514) → 500 instead of 402. No money lost; low-priority pre-launch fix. See `.squad/decisions/inbox/frank-balance-race-risk.md`.

**Verdict:** Money paths are sound for this slice. The two defects were idempotency-contract violations (wrong HTTP status under race/retry conditions), not money-loss bugs. Both fixed. Existing 11 tests continue to pass; 2 new tests cover the fixes.
