# Project Context

- **Project:** mrdj
- **Created:** 2026-06-23

## Core Context

Agent Rai initialized and ready for work.

## Recent Updates

📌 Team initialized on 2026-06-23

## Learnings

Initial setup complete.

---

## 2026-06-23 — Payment & Fairness Design Review

### What I Learned About mrdj's Money & Fairness Shape

**Project Type:** Jukebox-style social jukebox — guests request songs, pay credits to bump their requests in the queue.

**Monetization Model:**
- **Credits-first:** Guests buy credit packs with real money (via Stripe), then spend credits on queue actions.
- **Two bump types:**
  1. **Up Next** (always available) — modest bump toward the front (~5 positions), lower cost
  2. **Play Next** (single slot, not always available) — skip to position #1 (next to play), premium cost
- **Play Next state machine:** `available` → `locked` (someone purchased it) → `cooldown` (song is playing) → `available` (resets after song plays)
  - Only ONE Play Next holder at a time per event
  - Concurrency protection: row-level DB lock + atomic transaction

**Money Safety Patterns (Good Foundations):**
- Server-authoritative credit grants (webhook-triggered ONLY, idempotent)
- Append-only ledger (`CreditTransaction` table, immutable)
- Atomic DB transactions for spend + queue update (credit debit + position change in one tx)
- PCI SAQ-A compliance (Stripe hosted checkout, no raw card data on our servers)

**Key Fairness Gaps Identified (Advisory, Not Blockers):**
1. **Play Next availability transparency** — design doesn't specify HOW guests learn the slot is unavailable (locked/cooldown states need UI messaging)
2. **Refund policy undefined** — no spec for when/how refunds are granted (especially if DJ skips a paid Play Next song)
3. **Credit pack sizing** — docs recommend $5/$10/$20 packs to amortize Stripe fees, but no transparency requirement yet (risk of forced over-purchase feeling manipulative)
4. **Up Next vs Play Next naming** — similar names for different products; guests may confuse them without clear UI differentiation

**PII Handling:**
- Google SSO accounts store email + display name (necessary for feature)
- Guest sessions are anonymous (no PII unless they sign up)
- Privacy policy + data deletion endpoint not yet specified (flagged as pre-launch requirement)

**Secret Handling (Verified Safe):**
- All `.env.secret` files properly gitignored
- Only placeholder templates committed
- No real secrets in git history

### Learnings for Future Passes

1. **mrdj is a real-money app** → money safety (idempotency, server-authoritative grants, atomic transactions) is ALWAYS in scope for reviews.
2. **Fairness = transparency of mechanics** → any "not always available" paid feature needs clear status messaging in UI/UX to prevent "feels rigged" perception.
3. **Dark-pattern risk areas** for this domain:
   - Forced over-purchase (minimum credit packs)
   - Hidden unavailability (Play Next locked but no explanation)
   - Non-refundable surprises (DJ skips paid song, no refund)
4. **Design-phase reviews are advisory** → issue recommendations, not hard blocks, unless there's a committed secret or genuinely unsafe pattern being locked in.

---

**Next mrdj Review Triggers:**
- When UI/UX specs are written (check transparency of Play Next status, credit pack disclosure)
- When payment integration code is implemented (verify idempotency, webhook signature checks, no secrets in code)
- When privacy policy is drafted (check data retention, deletion endpoint, GDPR/CCPA basics)
- When refund policy is defined (check fairness for DJ-skipped songs, unused credits)
