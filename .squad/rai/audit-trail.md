# RAI Audit Trail

> Append-only evidence log. Entries are redacted — never contains raw secrets or harmful content.

<!-- Rai appends findings below -->

---

## 2026-06-23 — Payment & Fairness Design Review (Advisory Pass)

**Reviewed by:** Rai (Responsible AI Reviewer)  
**Requested by:** the project owner  
**Scope:** Design documents for payment integration and queue fairness mechanics (PRE-IMPLEMENTATION)  
**Review Type:** ADVISORY (non-blocking; recommendations only unless critical leak found)

### Documents Reviewed

1. `docs/decisions/payments-provider.md` (Frank — O1 Stripe recommendation)
2. `docs/ARCHITECTURE.md` (Rusty — credits ledger, Play Next state machine, money paths)
3. `.squad/decisions/inbox/frank-o1-payment-provider.md`
4. `.squad/decisions/inbox/rusty-architecture-v0.md`
5. `.squad/decisions/inbox/virgil-infra-confirmations.md`
6. Secret-handling configuration: `k8s/.env.example`, `k8s/.env.secret.example`, `.gitignore`

### Verdict: 🟡 YELLOW (Advisory Recommendations)

**Summary:** The payment and fairness design is **fundamentally sound** for a real-money jukebox application. Strong idempotency, server-authoritative credit grants, atomic transactions, and PCI SAQ-A compliance are all correctly specified. **NO CRITICAL LEAKS** found (all secret files properly gitignored, only placeholders in templates). However, several **fairness-transparency gaps** and **dark-pattern risk areas** need attention before UI/UX implementation to ensure honest monetization and prevent user frustration.

This is an **advisory pass** on design documents — no blocking issues, but recommendations below should inform UI, messaging, and policy decisions.

---

## Findings (WHAT → WHY → HOW)

### 🟢 STRENGTHS (What's Working Well)

#### 1. **Money Safety: Idempotency & Server-Authoritative Grants**

**WHAT:** The architecture correctly implements:
- Native `Idempotency-Key` header via Stripe for all payment mutations
- Server-side webhook verification BEFORE credit grants (payment webhook → verify signature → check idempotency key → atomic grant)
- Append-only `CreditTransaction` ledger with immutable records
- Single atomic DB transaction for credit spend + queue state update
- Row-level lock on `PlayNextSlot` to prevent double-sell of the premium slot

**WHY IT MATTERS:** Prevents double-charges, replay attacks, and race conditions in concurrent purchases. This is the **hard requirement** for real-money handling — correctly specified.

**RECOMMENDATION:** ✅ **KEEP AS-IS.** This design is production-grade for money safety.

---

#### 2. **PCI Compliance: No Raw Card Data On Our Servers**

**WHAT:** 
- Stripe Payment Element / hosted checkout specified
- All payment collection happens client-side via Stripe's hosted fields
- Backend only receives tokens, webhooks, and events
- Keeps mrdj at **PCI SAQ-A** scope (simplest compliance level)

**WHY IT MATTERS:** Raw card data on our servers would require PCI SAQ-D certification (expensive, complex, high audit burden). Hosted checkout is the correct pattern for a small team.

**RECOMMENDATION:** ✅ **KEEP AS-IS.** Document this clearly in developer onboarding so no one accidentally adds card-collection forms to the backend.

---

#### 3. **Secret Handling: Proper Gitignore Configuration**

**WHAT:** 
- Real secret files (`.env.secret.temp`) are **gitignored** (verified via `git check-ignore`)
- Only placeholder templates committed (`.env.example`, `.env.secret.example`)
- Placeholders use safe patterns: `<cluster-postgres-password>`, `<your-google-client-id>`, etc.
- No real secrets found in git history or tracked files

**WHY IT MATTERS:** Committed secrets are the **#1 critical violation** per the RAI policy — auto-fail. This repo handles secrets correctly.

**RECOMMENDATION:** ✅ **KEEP AS-IS.** Remind Virgil/Basher during implementation to NEVER commit `.env.secret.temp` or real API keys to git. The current setup is safe.

---

### 🟡 ADVISORY CONCERNS (Recommendations, Not Blockers)

#### 4. **Fairness Risk: Play Next Availability Transparency**

**WHAT:** The Play Next state machine is correct (available → locked → cooldown → available), but the **design docs don't specify HOW guests learn the slot is unavailable** when someone else has it.

**WHY IT MATTERS (Fairness):** 
- If the "Play Next" button is **visible but disabled** with no explanation, guests may think it's a bug or that the app is broken.
- If the button is **hidden** when unavailable, guests don't understand the mechanic — they may never discover the premium feature exists.
- If the UI shows "Play Next: $5" but doesn't explain it's a **single slot** (only one person can hold it at a time), guests may feel **cheated** when they try to buy and can't.

**DARK-PATTERN RISK:** Presenting Play Next as always-available when it's not → frustration → "pay-to-win feels rigged" perception.

**HOW TO FIX (UI/UX Recommendations for Linus):**

1. **Transparent status messaging:**
   - When `status == available`: "🎵 Play Next — Skip to #1 ($5)"
   - When `status == locked`: "🔒 Play Next — Held by [Guest Name] (available after their song plays)"
   - When `status == cooldown`: "🎶 Play Next — Playing now (available soon)"

2. **Visual indicator on the queue:**
   - Show which item holds the Play Next slot with a badge/icon (e.g., "🔥 PLAY NEXT" label)
   - This makes it clear to other guests that the slot is occupied

3. **Explainer on first view (tooltip or modal):**
   - "Play Next is a premium slot — only ONE guest can hold it at a time. After their song plays, the slot opens again."
   - Prevents confusion and sets fair expectations

**RECOMMENDATION:** 🟡 **ADD TO UI/UX SPEC (Linus).** The backend state machine is correct; the client needs to render availability truthfully. Add this to Linus's charter or a UX decision document.

---

#### 5. **Fairness Risk: Refund Policy Undefined**

**WHAT:** The architecture supports refunds (`refundCredits` method exists), but **no policy is documented** for:
- When refunds are granted (unused credits only? time window?)
- How guests request refunds
- What happens to a Play Next purchase if the DJ skips/rejects the bumped song

**WHY IT MATTERS (Fairness):** 
- If a guest buys Play Next and the DJ **manually skips their song** or rejects it, that's a **paid service not delivered** — refund is ethically required.
- If a guest buys a $10 credit pack but the event ends before they spend it, they may expect a refund (especially if it's their first time).
- **Ambiguity breeds chargebacks.** If the refund policy isn't clear, guests will file disputes with their bank/card issuer.

**DARK-PATTERN RISK:** Non-refundable credits + DJ arbitrary skips = feels like a scam. This is a **reputation and chargeback risk**.

**HOW TO FIX (Policy Recommendations for Frank + the project owner):**

1. **Define a guest-facing refund policy BEFORE launch:**
   - Example: "Unused credits are refundable within 30 days of purchase. Contact [support email]."
   - Example: "If your Play Next song is skipped by the DJ, you will receive a full refund to your credit balance."

2. **Automated refund triggers (recommended):**
   - If `QueueItem.is_play_next == true` and status changes to `rejected` by DJ → auto-refund the Play Next cost
   - Document this in the `admin` module spec (Basher)

3. **Guest-facing help text:**
   - Link to refund policy in the checkout flow ("Credits are refundable — [learn more]")
   - Reduces chargebacks and builds trust

**RECOMMENDATION:** 🟡 **STAGE A POLICY DECISION (Frank + the project owner).** Define the refund policy now so it's in the design, not retrofitted after complaints. This is an O2-adjacent decision (pricing + refunds are linked).

---

#### 6. **Dark-Pattern Risk: Credit Pack Sizing & Forced Over-Purchase**

**WHAT:** The payment provider decision (O1) recommends **credit packs** ($5, $10, $20) to amortize Stripe's $0.30 fixed fee. This is sound economically, but **no design exists yet for:**
- What if a guest only wants to spend $2 (one Play Next)?
- Can they buy smaller packs, or are they forced to buy $5 minimum?
- If packs are $5/$10/$20 only, is that clearly disclosed BEFORE checkout?

**WHY IT MATTERS (Dark Patterns):** 
- **Forced over-purchase** is a classic dark pattern: "You want $2 of credits? Too bad, minimum purchase is $5."
- This is **not inherently unethical** (many apps do this for fee reasons), but it must be **transparent**.
- If guests discover the minimum AFTER clicking "Buy Credits" → feels manipulative.

**BEST-PRACTICE EXAMPLES (Avoid These):**
- ❌ Bad: "Buy Credits" button → checkout shows $5 minimum with no warning
- ❌ Bad: "1 Play Next = $2" advertised, but you can only buy $5 packs (feels like a bait-and-switch)
- ✅ Good: "Credit Packs: $5 / $10 / $20" shown upfront; guests know the options before clicking
- ✅ Good: "Minimum purchase: $5 (lowest pack)" disclosed in checkout flow

**HOW TO FIX (Pricing Transparency for Frank + Linus):**

1. **Show pack sizes and prices BEFORE checkout:**
   - Example: "Buy Credits: 💰 $5 (50 credits) | 💰 $10 (110 credits +10% bonus) | 💰 $20 (240 credits +20% bonus)"
   - Guests see the structure upfront

2. **Explain why packs (optional, builds goodwill):**
   - "We offer credit packs to keep per-action fees low and give you better value on larger packs."
   - Honesty about the fee structure = trust

3. **Consider a smaller pack IF margin allows:**
   - If Play Next is $2, a $3 pack (30 credits) might feel fairer than forcing $5
   - Model this in O2 pricing work (Frank's domain)

**RECOMMENDATION:** 🟡 **ADD TRANSPARENCY REQUIREMENTS TO PRICING DECISION (O2).** When Frank finalizes pack sizes, ensure the UI spec includes upfront disclosure. Not blocking, but will prevent dark-pattern complaints.

---

#### 7. **Fairness Risk: "Up Next" vs "Play Next" Naming Clarity**

**WHAT:** The architecture distinguishes:
- **Up Next:** Reorders the queue by ~5 positions (bump toward the front) — always available
- **Play Next:** Moves a song to position #1 (next to play) — single slot, not always available

These are **different products** with different costs and availability.

**WHY IT MATTERS (Fairness):** 
- If guests don't understand the difference, they may:
   - Buy "Up Next" expecting immediate play (then feel ripped off when it's just a modest bump)
   - Not realize "Play Next" exists because they never scroll past "Up Next"
- The names are **subtly similar** — easy to confuse

**UI/UX CLARITY NEEDED:**
- Use **distinct visual language** (icons, colors, labels)
- Example:
   - 🔼 **Up Next** — "Move up ~5 spots ($1)"
   - 🔥 **Play Next** — "Skip to #1 — Next to Play ($5)" ← Emphasize immediacy

**RECOMMENDATION:** 🟡 **ADD TO UI/UX SPEC (Linus).** Make the distinction obvious in the guest-facing UI. The backend naming is fine; the client needs clear messaging.

---

#### 8. **PII Handling: Google SSO Email Storage**

**WHAT:** The `Account` entity stores `email` and `display_name` from Google SSO (per architecture doc). This is **necessary** for the feature, but it's **PII** (Personally Identifiable Information).

**WHY IT MATTERS (Privacy):** 
- Email addresses are PII under GDPR, CCPA, and most privacy laws.
- If mrdj has account holders (not just guests), we are a **data controller** and must:
   - Have a privacy policy
   - Support data deletion requests (right to be forgotten)
   - Disclose data usage (Google SSO consent flow should mention this)

**CURRENT STATUS:** Design docs mention Google SSO but **no privacy policy or data retention spec exists yet**.

**HOW TO FIX (Policy + Implementation for the project owner + Basher):**

1. **Create a minimal privacy policy BEFORE launch:**
   - "We store your email and display name to provide your account. We do not sell your data."
   - Link this in the Google SSO consent flow

2. **Implement account deletion:**
   - Endpoint: `DELETE /api/account/me` → anonymizes or deletes Account + Wallet + CreditTransaction history
   - OR retain transactions for audit (replace email with "deleted-user-{uuid}")

3. **Session token expiry:**
   - Guest sessions already have `expires_at` (good)
   - Account tokens should also expire (JWT expiry recommended in secret template — verify this is implemented)

**RECOMMENDATION:** 🟡 **ADD PRIVACY POLICY + DATA DELETION TO IDENTITY MODULE SPEC (Basher).** Not blocking the design, but required before public launch. Flag this to the project owner as a pre-launch checklist item.

---

#### 9. **Accessibility Note: Inclusive Language in Templates**

**WHAT:** Reviewed all design docs and config templates for terminology from the policy's "Avoid" list (whitelist/blacklist, master/slave, sanity check, dummy, guys, man-hours).

**FINDINGS:** ✅ **NO ISSUES FOUND.** 
- Docs use "allowlist/blocklist" terminology (if applicable)
- No ableist or gendered language detected in reviewed materials
- "Primary/replica" pattern (not master/slave) implied in Postgres docs (Virgil's note)

**RECOMMENDATION:** ✅ **KEEP AS-IS.** Team is already following inclusive language standards. Remind reviewers to continue this during code implementation.

---

### 🔴 CRITICAL VIOLATIONS

**NONE FOUND.** No hardcoded secrets in git, no injection vulnerabilities in design (too early for code), no harmful content.

---

## Recommendations Summary (Priority Order)

| Priority | Finding | Owner | Action |
|----------|---------|-------|--------|
| **HIGH** | Play Next availability transparency (Finding #4) | Linus (UX) | Add status messaging to UI spec: show when slot is locked/cooldown, who holds it, when it resets |
| **HIGH** | Refund policy undefined (Finding #5) | Frank + the project owner | Define refund policy BEFORE launch; implement auto-refund for DJ-skipped Play Next songs |
| **MEDIUM** | Credit pack transparency (Finding #6) | Frank + Linus | Show pack sizes upfront in UI; disclose minimum purchase before checkout |
| **MEDIUM** | Privacy policy + data deletion (Finding #8) | the project owner + Basher | Write minimal privacy policy; implement account deletion endpoint before public launch |
| **LOW** | Up Next vs Play Next naming clarity (Finding #7) | Linus (UX) | Use distinct visual language (icons, labels) to differentiate the two bump types |

---

## Next Actions for the project owner

1. **Review this audit** and decide if any findings should block O1/O2 decisions.
2. **Assign refund policy work** to Frank (or keep in O2 pricing scope).
3. **Flag privacy policy** as a pre-launch checklist item (not urgent now, but required before public beta).
4. **Forward UI/UX recommendations** (Findings #4, #6, #7) to Linus when the frontend work begins.

---

**Reviewed:** 2026-06-23  
**Verdict:** 🟡 YELLOW (advisory recommendations; no blockers)  
**Status:** NON-BLOCKING — work proceeds with suggestions attached
