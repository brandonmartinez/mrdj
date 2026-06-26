# Squad Decisions

> Single source of truth for scope, architecture, and process decisions on **mrdj**.
> Recorded by the Coordinator. Agents propose via `.squad/decisions/inbox/`; Scribe merges.

## Active Decisions (Decided)

### 2026-06-23 — D1: Tech stack locked
**Decision:** Node.js backend; React + Tailwind CSS frontend with reusable components; PostgreSQL for persistence.
**By:** the project owner (project brief). **Owners:** Basher (backend), Linus (frontend).
**Why:** Owner preference; well-supported, fits the cluster and team.

### 2026-06-23 — D2: Deployment = k3s, mirror the reference app's pattern
**Decision:** Containerize and publish to GHCR (`ghcr.io/brandonmartinez/mrdj`); deploy to k3s with Kustomize + Traefik ingress + cert-manager TLS (`letsencrypt-prod`). Public host `mrdj.themartinez.cloud` (`host: mrdj.${NETWORK_HOSTNAME_SUFFIX}`). Follow the cluster infrastructure repo the reference app manifests: namespace, deployment with `/api/health` startup/readiness/liveness probes, service, ingress, HPA (2–3), PDB (minAvailable 1), Kustomize configMap/secret generators.
**By:** the project owner (brief). **Owner:** Virgil.
**Why:** Proven pattern already running in the same cluster.

### 2026-06-23 — D3: Roles & access
**Decision:** Guest access with **no account required**; optional accounts via **Google SSO** to start; **Admin** (DJ / event manager) role with elevated queue-management permissions.
**By:** the project owner (brief). **Owner:** Basher.

### 2026-06-23 — D4: Monetization mechanics
**Decision:** **Credits/wallet** is the primary spend mechanism (buy credits, then spend them). Actions: (a) request a song to the queue — free or low-cost (see O2); (b) **pay to bump** a request to **Up Next**; (c) **pay more** for premium **Play Next**. Play Next rules: only **ONE** is purchasable at any time; it is **not always available**; it **resets** to available **after** the bumped song has played. Real money is involved — treat all spend paths as auditable.
**By:** the project owner (brief). **Owners:** Frank (payments/credits), Basher (queue state machine).

### 2026-06-23 — D5: Engineering principles & workflow
**Decision:** SOLID, DRY, YAGNI throughout. Iterative **loop-engineering** workflow (see `docs/LOOP-ENGINEERING.md`). Maker/checker split enforced: implementer authors, **Rusty** reviews and gates, **Rai** runs RAI/safety review. MVP-first.
**By:** the project owner (brief). **Owners:** Saul (process), Rusty (technical).

### 2026-06-24 — D6: Slice-01 Local Guest Jukebox scope, stubs, and contracts locked
**Decision:** First build slice is a locally runnable guest jukebox vertical slice in a devcontainer: backend + frontend via `npm run dev`, app container + Postgres service, frontend on a local URL, and no k3s for this slice. Action labels are **Add to Queue** (normal request, 0 credits), **Boost** (paid Up Next bump), and **Play Next** (premium single-slot). O2 defaults to normal request = 0 credits; Boost and Play Next use seeded server-side pricing. Payments, music providers, Google SSO, and real DJ rig integration are stubbed behind abstractions; client never mutates balance; paid actions are one DB transaction, server-priced, idempotency-keyed, and row-locked where required. Guest wallet is event-scoped for local; dev role switcher is allowed while backend enforces admin routes; queue-view drives Cover Flow with `{ nowPlaying, previous[], upcoming[], playNextStatus, creditBalance }`; DB access remains PgBouncer-safe.
**By:** the project owner (Brandon Martinez) + Squad Coordinator. **Owners:** Basher, Linus, Frank, Livingston, Virgil, Saul.
**Why:** Locks a zero-external-dependency, local-first MVP slice while preserving production seams. O1, O3, O6, and O7 remain broader decisions outside this slice; O2 is locked only as the slice default.
**Docs:** `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`

### 2026-06-24 — D7: Multi-tenant marketplace architecture
**Decision:** mrdj is now a multi-tenant marketplace. **Organization** is the tenant (DJ business; a solo DJ is an Organization of one). **Membership** links Account/User to Organization with org role `owner` | `manager` | `dj` | `staff`, replacing the global "admin = the DJ" assumption from D3. **Event** belongs to exactly one Organization, has an assigned lead DJ, and may run concurrently with other Events in the same Organization. **Area** is an optional Event subdivision; every Event has at least one default Area, and each Area owns its own queue + Play Next slot. Credits/wallets, pricing config, credit bundles, and payment/transfer ledger records are Organization-scoped via `organization_id`. Monetization is **Marketplace via Stripe Connect**: the platform collects guest credit purchases, takes a platform fee, and pays out the DJ tenant; each Organization is a Stripe connected account. Tenant isolation for MVP is app-level `organization_id` scoping through a single query seam, with Postgres RLS deferred as later hardening.
**By:** the project owner (locked direction) + Rusty (architecture). **Owners:** Rusty (architecture), Frank (Connect/payouts), Saul (scope).
**Why:** This supersedes the charter/PRD stance that "multi-tenant SaaS = out of scope" and supports concurrent Events across multiple lead DJs plus large Events split into multiple Areas. It extends O1's Stripe recommendation into Stripe Connect marketplace payouts rather than contradicting it. It extends D4's credits/wallet mechanic by making credits Organization-scoped, relates D3 roles to Membership org roles plus a separate Platform Admin, and refines A1's Event→Queue→PlayNextSlot baseline to Event→Area→Queue/PlayNextSlot.
**Doc:** `docs/ARCHITECTURE.md`

### 2026-06-24 — D8: Data layer = Drizzle (ORM + drizzle-kit migrations)
**Decision:** Adopt **Drizzle ORM** (`drizzle-orm`) for data access and **`drizzle-kit`** for migrations, replacing raw `pg` queries and node-pg-migrate (raw `pgm.sql`). Drizzle runs over the existing `pg` driver/pool and the TypeScript schema becomes the typed source of truth. Money-path row locks stay first-class via Drizzle's `.for('update')`; explicit transactions, idempotency keys, and the `CreditsService` seam (A1) are unchanged. The tenant query seam (D7, O13) is implemented as a Drizzle scoped helper (`forOrg(organizationId)`) so handlers cannot bypass `organization_id` filters.
**By:** the project owner (Brandon) + Rusty (architecture). **Owners:** Basher (data layer), Rusty (review).
**Why:** Best fit for this stack: PgBouncer transaction pooling (A2) — Drizzle needs no named prepared statements and no separate migration `directUrl`; preserves explicit `SELECT … FOR UPDATE` correctness (A1/W4) that an ORM fluent API would otherwise push back to raw SQL; the typed schema de-risks multi-tenant `organization_id` scoping (D7); lightweight footprint for k8s; and incremental, table-by-table adoption over the shipped slice-01/02 SQL. **Prisma was considered and rejected** for this app: PgBouncer friction (prepared statements, a separate migration `directUrl`, and no `LISTEN/NOTIFY` — which A3's production realtime path needs), `FOR UPDATE` not expressible in its fluent API, and a heavier rewrite. Resolves A2's open "confirm Node.js DB driver/ORM" follow-up. Sequencing: adopt Drizzle over the current schema **first** (prerequisite epic), then author the D7/O15 multi-tenant migration as Drizzle migrations.
**Doc:** `docs/ARCHITECTURE.md` §8

### 2026-06-24 — D9: Multi-tenant marketplace open decisions confirmed (O8–O16)
**Decision:** The project owner confirmed the Rusty/Frank recommendations for O8–O16 **as-is**:
- **O8 — Credits are Organization-scoped** (no cross-org portability); keeps Connect payouts, refunds, liability, and tenant reporting correct.
- **O9 — Per-Organization pricing config + credit bundles with platform defaults**; new Orgs inherit defaults, owners/managers may override later.
- **O10 — Stripe Connect Express** account type per Organization (hosted onboarding/KYC).
- **O11 — Percentage application fee** on guest credit purchases via destination/separate charges to the Org connected account.
- **O12 — Path-based `/o/{slug}` tenant routing** for MVP (no wildcard DNS/TLS); subdomains deferred.
- **O13 — App-level `organization_id` scoping** through a single query seam (Drizzle `forOrg`); Postgres RLS deferred as later hardening.
- **O14 — Stripe Connect Express hosted onboarding**; an Organization cannot accept paid actions until `charges_enabled`, payout readiness tracks `payouts_enabled`.
- **O15 — Backfill a default Organization + default Area per existing Event**; re-scope existing wallets/credits/pricing/bundles to the default Org; move `queue_items`/`play_next_slot` onto Area.
- **O16 — Defer DJ subscription tiers**; marketplace fee is the MVP revenue model, revisit post-launch.
**By:** the project owner (Brandon) — confirmed as-is. **Owners:** Frank (O8–O11/O14 payments+Connect), Rusty (O12/O13 routing+isolation), Basher (O15 backfill), Saul (O9/O16 scope).
**Why:** Unblocks Epics 2 (#6) and 4 (#8) and their stories; closes decision spikes #96–#103. O2, O5, O6, O7 remain open (tracked in Epic 10 #14).
**Doc:** `.squad/decisions.md` O8–O16 (now ✅ RESOLVED).

### 2026-06-24 — D10: Remaining MVP open decisions confirmed (O2, O5, O6, O7)
**Decision:** The project owner confirmed:
- **O2 — Normal request cost = FREE (0 credits) platform default.** "Add to Queue" stays free; abuse controlled by per-guest/session rate limiting, dedup of identical pending requests, and DJ moderation (reorder/remove/reject). Per-Organization override (O9) may set a low cost. Consistent with D4/D6 and shipped slice-01/02.
- **O5 — k8s manifests = cluster infrastructure repo canonical** (Virgil's recommendation). Keep a validated skeleton in `mrdj/k8s/` for reference/local; promote to the cluster repo for deployment; secrets via the cluster repo's gitignored `.env.secret.temp`. mrdj stays a single deployment — tenancy is app-level (`/o/{slug}` + `organization_id`), no per-tenant infra.
- **O6 — Music = Spotify first** (MVP) behind the provider-agnostic `Track` abstraction (A1); **Apple Music** as a fast follow; **far-future backlog:** a **Serato + Rekordbox** companion client app that reads the DJ's local libraries and syncs upward. Provider is the search/catalog source, not playback.
- **O7 — Refund/dispute policy (MVP):** in-app credit auto-return (slice-02 + O18 P1-A) is the primary remedy; **purchased credits are non-refundable to card by default, disclosed at checkout**; **money refunds** only for genuine failures (duplicate/erroneous charge, undelivered service), **initiated by the DJ Organization** via Stripe with the platform **application fee reversed proportionally** (`refund_application_fee`); guest credits non-refundable (event/session-scoped, disclosed); `charge.dispute.created` flags the org account + notifies the platform (respond with ledger evidence); **self-serve unused-credit refunds deferred post-MVP** (Rai's broader proposal, revisited once volume/abuse is known).
**By:** the project owner (Brandon) — confirmed. **Owners:** Frank (O2 pricing default + O7 refunds/Connect), Virgil (O5 infra), Livingston (O6 providers), Saul (O2/O6/O7 scope).
**Why:** Closes the remaining open product/infra decisions, unblocking the music epic and ops/deploy work and completing Epic 10 (#14). O2 aligns with D4/D6 + per-org O9; O5 matches the reference-app pattern; O6 minimizes MVP surface via the existing Track seam; O7 is marketplace-correct (proportional fee reversal) and fairness-preserving (in-app auto-return) while limiting money-refund/dispute exposure.
**Docs:** `.squad/decisions.md` O2/O5/O6/O7 (now ✅ RESOLVED); Serato/Rekordbox tracked on the future backlog (Epic 11, #15).

### 2026-06-23 — A1: Architecture baseline v0 (MVP)
**Decision:** Core entities (User, Event, Queue, QueueItem, Track, Wallet, CreditTransaction, PlayNextSlot) defined. Play Next state machine: `available` → `locked` → `cooldown` → `available`; single purchasable at a time; resets AFTER bumped song plays; concurrency via row-level lock. Credits-ledger contract seam named `CreditsService` (idempotent, append-only). Up Next vs Play Next distinguished. Module layout: identity, event, queue, credits, payments, music, realtime, admin.
**By:** Rusty (architect). **Owners:** Rusty, Basher (queue/state machine), Frank (credits ledger consumer).
**Touches:** O2 (normal request cost — free or low-cost, pricing config drives spend), O6 (Track abstraction is provider-agnostic, MVP scope TBD), O3 (framed but owned by Basher).
**Doc:** `docs/ARCHITECTURE.md`

### 2026-06-23 — A2: Infrastructure confirmations
**Decision:** (a) `${NETWORK_HOSTNAME_SUFFIX}=themartinez.cloud` confirmed; mrdj ingress resolves to `https://mrdj.themartinez.cloud`. (b) **Shared PostgreSQL via PgBouncer (transaction pooling) at `postgres-svc.data.svc.cluster.local:5432`, database `mrdj` created via postgres-init ConfigMap.** Connection string: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres-svc.data.svc.cluster.local:5432/mrdj`. Database provisioning: add `init-mrdj-db.sh` to the cluster's shared-database `postgres-init` ConfigMap (data namespace).
**By:** Virgil (DevOps). **Owner:** Virgil (infra), Basher (DB driver/ORM confirmation).
**Follow-up from Basher:** Confirm Node.js DB driver (Prisma/TypeORM/Sequelize/pg) and PgBouncer transaction-pooling compatibility. **Resolved by D8:** Drizzle ORM + drizzle-kit, chosen for PgBouncer transaction-pooling compatibility over the `pg` driver.
**Doc:** `k8s/` skeleton (this repo).

### 2026-06-24 — A3: Realtime transport = SSE
**Decision:** Realtime queue sync uses **SSE (Server-Sent Events)**, not WebSocket, beginning in slice-02. Implement behind a `RealtimeService` seam with endpoint shape `GET /api/events/:slug/stream` emitting `queueView` events on queue/credit/admin mutations. Local/MVP broker is an in-process `EventEmitter`; frontend consumes through `EventSource` and keeps a polling fallback. The seam must allow a later Postgres `LISTEN/NOTIFY` broker, but PgBouncer transaction pooling cannot support `LISTEN/NOTIFY`; production listeners need a dedicated direct Postgres connection, sticky sessions, or another broker strategy.
**By:** the project owner (Brandon) + Coordinator. **Owners:** Basher (backend transport/seam), Linus (EventSource client), Rusty (review).
**Why:** Matches A1's mostly server→client fan-out framing and preserves simple local delivery while flagging the multi-replica production caveat.

### 2026-06-24 — BP1: Phase 2 roadmap and 100-issue backlog created
**Decision:** Phase 2 planning complete. `docs/ROADMAP.md` authored with the release train v0.2.0→v0.6.0+backlog, dependency/sequencing diagram, and epic→release→owner table (references D7, D8, A1–A3, O2, O5, O6–O16). 11 EPIC GitHub issues created (#5–#15) and 89 story issues (#16+), totaling 100 issues. Sequencing: Drizzle (Epic 1, #5, v0.2.0) → Multi-tenant core (Epic 2, #6, v0.3.0) → Auth (Epic 3, #7, v0.3.0) → Payments/Stripe Connect (Epic 4, #8, v0.4.0) → DJ UX + Guest UX (Epics 5–7, #9–#11, v0.4.0–v0.5.0) → Scale + Ops (Epics 8–9, #12–#13, v0.6.0). Open decisions/spikes (Epic 10, #14) run concurrently from v0.3.0. Future/backlog (Epic 11, #15).
**By:** Rusty (technical sequencing plan) + Saul (ROADMAP.md + epic issues) + saul-core/saul-money/saul-experience/saul-ops (story issues). **Owners:** Saul (scope), Rusty (technical).
**Doc:** `docs/ROADMAP.md`; GitHub epics #5–#15.

### 2026-06-24 — W4: Slice-02 review resolution
**Decision:** Fix the `advanceQueue` refund-after-play race by selecting the next pending item with `FOR UPDATE` and promoting with an `AND status='pending'` guard, so a concurrently rejected/refunded item cannot still be promoted to playing. Also refetch `/me` after console grants so the admin header shows the admin's balance, and correct `docs/slice-02-contract.md` stats shape to `{ stats: {...} }`. Defer the dev `act-as` fail-open concern to slice-02 deferrals as prod-only hardening.
**By:** Coordinator, based on code-review and rubber-duck findings. **Owners:** Basher/Linus as applicable; Rusty review.
**Why:** Preserves money correctness for slice-02 without changing local MVP auth semantics.

## Open Decisions (Need Resolution)

### O1 — Payment provider — HIGH PRIORITY ⏳
**Question:** Stripe vs PayPal vs Amazon Pay vs others for the credits/wallet model?
**Recommendation (2026-06-23, Frank):** **Stripe**. Native idempotency headers (critical for retry-safe, server-authoritative credit grant flow), best-in-class webhooks, mobile-first checkout via Payment Element (Apple Pay/Google Pay), excellent Node.js SDK. PCI SAQ-A scope (no raw card data on servers). Credits/wallet model maps cleanly to Payment Intents. Transaction fees 2.9% + $0.30 manageable with credit-pack sizing ($5/$10/$20). D7 extends this to Stripe Connect marketplace payouts. **Status:** PROPOSED — pending the project owner's confirmation.
**Owner:** Frank (payments/credits), Basher (ledger interface), Linus (checkout UX). **Input:** Saul (product).
**Doc:** `docs/decisions/payments-provider.md`

### O2 — Normal request cost ✅
**Question:** Is adding a normal request free or low-cost? Affects pricing and abuse control.
**Resolution (2026-06-24):** **FREE (0 credits)** platform default; abuse via rate-limit + dedup + DJ moderation; per-org override via O9. Owner confirmed — see D10.
**Owner:** Saul + Frank. **Status:** ✅ RESOLVED.

### O4 — Dedicated QA agent? ⏳
**Question:** Add a dedicated Tester/QA agent now, or keep testing as an implementer-owned discipline gated by Rusty (current default)?
**Owner:** Squad + the project owner. **Status:** OPEN — defaulting to implementer-owned + review gate for MVP. Casting headroom exists (Ocean's Eleven, capacity 14).

### O5 — Where do mrdj k8s manifests live? ✅
**Question:** In this repo (`mrdj/k8s/`) or in the cluster infrastructure repo alongside the reference app?
**Recommendation (2026-06-23, Virgil):** **Cluster repo canonical** (the cluster infrastructure repo, under its mrdj resource path). Rationale: single source of truth for cluster state (already proven with the reference app), clean separation (app code in mrdj repo, deployment in cluster repo), straightforward promotion workflow (author skeleton in `mrdj/k8s/`, validate, copy to cluster repo post-launch). Secret management via cluster repo gitignored `.env.secret.temp` files. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed Virgil's recommendation as-is; see D10.
**Owner:** Virgil (infra). 
**Doc:** Skeleton in `k8s/` (this repo); promotion documented in virgil-infra-confirmations.md.

### O6 — Music provider MVP scope ✅
**Question:** Launch with both Apple Music AND Spotify, or one first behind a normalized Track abstraction?
**Resolution (2026-06-24):** **Spotify first** behind the `Track` abstraction; **Apple Music** fast-follow; far-future backlog: **Serato + Rekordbox** companion app reading the DJ's local libraries. Owner confirmed — see D10 / Epic 11 (#15).
**Owner:** Livingston + Saul. **Status:** ✅ RESOLVED.

### O7 — Refund / dispute policy ✅
**Question:** How are credits and Play Next purchases refunded? When? Who gets a refund?
**Partially resolved (2026-06-24, Coordinator):** For slice-02, admin remove/reject of a **pending** queue item with paid spend (Boost or Play Next) and not yet played auto-refunds the exact credits spent through an append-only `refund` ledger entry using idempotency key `refund-<queueItemId>`. If the removed item is the Play Next holder, reset `play_next_slot` to available. Normal advance/skip does **not** refund; free removals have nothing to refund. Requests remain auto-approved; DJ moderation is reorder/remove/reject, not a pre-play approval queue.
**Remaining proposal (2026-06-23, Rai):** Account holders can request refund for unused credits within 30 days of purchase; guest sessions are non-refundable and disclosed at checkout; refund policy UI should be linked from checkout/profile/FAQ; Stripe `charge.dispute.created` should flag accounts for review. Production real-money policy still needs final owner/Frank/Saul resolution.
**Resolution (2026-06-24):** MVP policy confirmed — in-app credit auto-return is primary; purchased credits non-refundable to card (disclosed at checkout); money refunds case-by-case by the DJ Organization for genuine failures with proportional application-fee reversal; guest credits non-refundable; disputes flag the org account; self-serve unused-credit refunds deferred post-MVP. See D10.
**Owner:** Frank (payments/refunds) + Saul (scope/policy). **Input:** Linus (UI), Basher (admin module). **Status:** ✅ RESOLVED.
**RAI reasoning:** Fairness + transparency trust builder. Dark-pattern avoidance. Chargeback economics: $15 fee per dispute vs $0 ledger entry for refund.

### O8 — Credit/wallet scope ✅
**Question:** Are guest/account credits portable across Organizations, or scoped to the Organization where they were purchased/granted?
**Recommendation (2026-06-24, Rusty):** **Organization-scoped.** Guest credits at Organization A's event are not portable to Organization B; this keeps Stripe Connect marketplace payouts, refunds, liability, and tenant reporting correct. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Frank + Rusty.

### O9 — Per-Organization pricing config + credit bundles ✅
**Question:** Are pricing config and credit bundles global platform settings, or configurable per Organization?
**Recommendation (2026-06-24, Rusty):** **Per-Organization with platform defaults.** New Organizations inherit sensible defaults; owners/managers can override bundles and action costs later. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Frank + Saul.

### O10 — Stripe Connect account type ✅
**Question:** Which Stripe Connect account type should each Organization use?
**Recommendation (2026-06-24, Rusty):** **Express.** Fast hosted onboarding/KYC, fewer platform support burdens, and enough platform-controlled UX for MVP. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Frank.

### O11 — Platform-fee model ✅
**Question:** How should the platform fee be calculated and collected on guest credit purchases?
**Recommendation (2026-06-24, Rusty):** **Percentage application fee** on credit purchases, using destination or separate charges to the Organization connected account. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Frank + Saul.

### O12 — Tenant routing ✅
**Question:** Should tenant routing use path-based `/o/{slug}` URLs or per-Organization subdomains?
**Recommendation (2026-06-24, Rusty):** **Path-based `/o/{slug}` for MVP.** Avoid wildcard DNS/TLS and tenant certificate complexity now; subdomains can come later. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Rusty + Linus.

### O13 — Data-isolation enforcement ✅
**Question:** Should tenant isolation be enforced with application-level `organization_id` scoping or PostgreSQL row-level security?
**Recommendation (2026-06-24, Rusty):** **App-level `organization_id` scoping for MVP** through a single query seam. Add Postgres RLS later as a hardening layer once tenant boundaries stabilize. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Rusty + Basher.

### O14 — DJ onboarding/KYC flow ✅
**Question:** How does an Organization complete payout onboarding and when can it accept paid actions?
**Recommendation (2026-06-24, Rusty):** **Stripe Connect Express hosted onboarding.** An Organization cannot accept paid actions until its connected account is `charges_enabled` and payout readiness tracks `payouts_enabled`. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Frank + Saul.

### O15 — Single-tenant → multi-tenant data migration/backfill ✅
**Question:** How should existing single-tenant data be backfilled into the multi-tenant model?
**Recommendation (2026-06-24, Rusty):** Backfill a **default Organization** and a **default Area per existing Event**; scope existing wallets, credits, pricing, and bundles to the default Organization; move `queue_items` and `play_next_slot` onto Area. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Basher + Rusty.

### O16 — Optional DJ subscription tiers later ✅
**Question:** Should mrdj add DJ subscription tiers in addition to marketplace fees?
**Recommendation (2026-06-24, Rusty):** **Defer.** Marketplace fee is the MVP revenue model; revisit subscription tiers post-launch once usage and tenant economics are known. **Status:** ✅ RESOLVED (2026-06-24) — owner confirmed as-is; see D9.
**Owner:** Saul.

## Governance

- All meaningful changes require team consensus; **Rusty** is the technical tiebreaker, **Saul** owns scope.
- Agents propose decisions in `.squad/decisions/inbox/`; the **Scribe** merges them here.
- Keep per-agent history focused on work; keep this file focused on direction.

### O17 — Balance-check race → wrong HTTP 500 vs 402 (deferred post-slice-01) ⏳
**What:** Concurrent paid actions for the same user when wallet balance equals exactly the minimum required cost can both pass the app-level `balance < cost` check; one debit commits, the other hits the DB `CHECK (balance >= 0)` constraint and returns HTTP 500 instead of the expected 402 `insufficient_credits`. No money is lost (constraint prevents negative balance), but the error response is incorrect and can confuse clients.
**Recommended fix (Frank):** In `createRequestHandler` catch block, detect Postgres error code `23514` (check_violation on `wallets_balance_check`), re-read actual balance, and return a proper 402 with `required` and `balance` fields. No DB migration needed; touches `api/src/queue/index.ts` catch block only.
**Owner:** Frank (fix) + Basher (review). **Status:** DEFERRED — acceptable for single-tenant local slice-01 (low concurrency); must fix before multi-user production launch.
**Reported by:** Frank, 2026-06-23.

### O18 — RAI slice-01 pre-launch action items ⏳
**From:** Rai post-code review, 2026-06-23. Verdict: 🟢 GREEN for local dev slice.
**P1-A (required before real-money):** Auto-refund Play Next credits when DJ advances (skips) while `play_next_slot.status = 'locked'`. O7 partial resolution covers admin remove/reject; advance/skip is still unhandled. Owners: Basher (advance endpoint) + Frank (refundCredits seam) + Linus (UI copy: "If the DJ skips your Play Next song, your credits are automatically refunded.").
**P1-B (required before public launch):** `ConfirmModal.tsx` processing→success/error transitions are silent to screen readers on a real-money modal. Add `aria-live="polite" aria-atomic="true"` to card div; `role="status"` + `aria-label` to spinner/success/error states; move focus to `firstFocusRef` after `setPhase('error')`. Owner: Linus.
**P2-A (recommended):** Discount badge "SAVE X%" basis is ambiguous. Frank defines basis or drops the claim; Linus implements. Options: remove % + bonus-credits chip (cleanest), define "X% more credits vs Starter rate," or "Best Value" badge for VIP only.
**P2-B (recommended):** Play Next status bar in `App.tsx` has no `aria-label`. Add contextual label with status and price (~5 min). Owner: Linus.
**P3-A (optional):** "Slot taken" tooltip lacks timing. Add: "Slot taken — available after the current Play Next song plays." Owner: Linus.
**Status:** OPEN. P1-A and P1-B required before real-money/public launch; P2–P3 recommended before production.


### 2026-06-24 — iTunes top-tracks dev seed
**Decision:** Use Option B for the dev seed: fetch and upsert roughly 85 iTunes catalog tracks (`provider='itunes'`) and repoint the seeded demo event's 11 queue items to real iTunes tracks so the guest jukebox cover-flow carousel shows real artwork.
**By:** Livingston. **References:** issue #9; commits `858f031` and `774e760`.
**Why:** Option B best matched the owner goal of real cover art in the carousel, not only in search. The seed remains best-effort and idempotent, and falls back to the public-domain stub tracks on any iTunes outage.
**Constraint found in review:** The iTunes dev seed must be explicitly controlled by `SEED_ITUNES`. CI seeds with `SEED_ITUNES=false`, and Vitest global setup resets and seeds stub-only data before the suite so tests remain deterministic and do not inherit shared dev catalog rows or iTunes queue foreign keys.

### 2026-06-25 — D: P0/P1 remediation accepted behind reviewer gates
**Decision:** The team accepted the remediation of all 5 P0 and all 7 P1 findings from `docs/reviews/2026-06-24/SUMMARY.md`; the 4 P2 findings remain open follow-ups.
**By:** Rusty reviewer gates 1–3; implemented by Basher, Linus, Virgil, Saul, Frank, and Livingston. **Owners:** Rusty for gate workflow; Scribe for history.
**Why:** Paid-public MVP blockers from the full-cast review needed to be closed before further launch work. The shared Postgres test setup required DB-bound backend work to be serialized while non-DB work ran in parallel.
**Evidence:** Wave 1 approved and pushed as `4d05684`; payments gate approved and pushed as `87460ba`; music gate approved and pushed as `6afb22f` (`origin/main` HEAD). API tests: 134 passing; TypeScript clean except pre-existing `music.test.ts(33,41)` TS1343. Dev DB re-seeded with iTunes: 85 tracks cached and demo queue 11/11 real artwork URLs.
**Open follow-ups:** 4 P2s from the review; Rusty nits routed away from original authors: Basher for payments follow-ups (`payments.test.ts:491`, `refund.ts:64-68`, `seed.ts:181`), latent music cancellation note (`http.ts:122-126`), and architecture follow-ups for `adminStats` `areaId`, session regeneration, transactional area+slot creation, and `guest_sessions` pruning.

### 2026-06-25 — P2 / follow-up remediation wave merged
**Decision:** Track the post-P0/P1 P2 and Rusty-nit remediation as an issues-filed → Rusty-gated → pushed workflow on `main`.
**By:** Scribe, recording the cast outcome. **Owners:** Basher, Linus, Rai, Saul, Virgil, Livingston.
**Why:** The cast filed #106–#116 with `squad:{owner}` labels, shipped the Rusty-approved wave as `584065c`, then shipped Basher's follow-up server-side zero-credit bundle guard as `2acc00e` (`origin/main` HEAD). API tests were 139 passing; web build was green; TypeScript was clean except pre-existing `music.test.ts(33,41)` TS1343. Deferred tracking remains open for #107, #115, #116, and #114 post-window money-retry idempotency.

## Epic #130 UI Review Remediation (Waves 1+2) — Issues #119–#126

### 2026-06-26 — Wave A: Mobile nav, DJ console theming, dashboard quick-path (Linus)
**Decision:** Implemented #119 (OrgShell mobile nav drawer, slide-in from left, closes on navigation/backdrop/Esc, focus trap via Radix), #120 (AdminConsole theme tokens — zinc hardcodes replaced with semantic `bg-card`, `text-foreground`, `border`; Grant CTA violet; no remaining off-brand amber), #121 (OrgDashboard recent-event rows clickable with keyboard support; console shortcut appears for live events).
**By:** Linus (Frontend Engineer). **Files:** OrgShell, AdminConsole, OrgDashboard + 3 testids per issue.
**Build:** ✅ `tsc --noEmit && vite build` green.
**Testids added:** `mobile-nav-button`, `mobile-nav-drawer`, `console-grant-cta`, `recent-event-row`, `dashboard-console-shortcut`.
**Why:** Completes Wave A acceptance criteria; all 3 issues satisfy their own requirements. Routed to Linus per routing.md (frontend).

### 2026-06-26 — Wave B: Responsive jukebox, gold cost tokens, search overlay, contextual modal, header user menu (Linus)
**Decision:** Implemented #122 (GuestJukebox/CoverFlow responsive redesign — mobile stacked, desktop two-column `grid-cols-1 lg:grid-cols-2`; deduplicated queue in CoverFlow), #124 (gold coin cost tokens `CostToken.tsx` component; Play Next affordance/upsell; tappable insufficient tiers), #123 (search overlay as fixed `z-[90]` popover; queue anchored below), #125 (contextual modal with per-tier button labels: "Add to Queue!", "Boost!", "Play Next!", "Buy Credits!"; visible close button), #126 (header user dropdown menu; dev role switch moved into menu; credits button triggers buy flow).
**By:** Linus (Frontend Engineer). **Files:** GuestJukebox, CoverFlow, TrackRow, ConfirmModal, Header, SearchBar, CostToken (new).
**Build:** ✅ `tsc --noEmit && vite build` green.
**Testids added:** `cost-token`, `play-next-cta`, `search-trigger`, `search-overlay`, `modal-primary-button`, `modal-close`, `header-user-menu`, `header-role-switch`, `header-buy-credits`.
**Tradeoff:** Buy-credits via dummy track (reuses modal flow) — recommended later dedicated buy-credits modal (deferred).
**Why:** Completes Wave B acceptance criteria; all 5 issues satisfy their requirements. Sequential routing (same implementer avoids GuestJukebox.tsx collision).

### 2026-06-26 — Epic #130 Review & Approval (Rusty)
**Decision:** Reviewed all 8 issues (#119–#126) against acceptance criteria. Per-issue: ✅ PASS on each. Cross-cutting: accessibility (focus trap, dialog roles, aria-labels), theming (violet consistency, gold tokens intentional), correctness (buy-credits approach sound, non-blocking nit), hygiene (no api/ changes, build green, 16 testids added).
**By:** Rusty (Lead / Architect). **Verdict:** 🟢 **APPROVE** — all 8 satisfied, ship-ready pending owner's recorded-demo review.
**Non-blocking note:** Header buy-credits uses synthetic dummy track — consider dedicated buy-credits modal flow post-launch.
**Why:** Enforcement of maker/checker split per D5; all issues sandbox-correct and reviewer-approved.
**Outcome:** 10 web files changed (9 modified, 1 new: CostToken.tsx). 16 data-testids added. `tsc --noEmit && vite build` green. api/ untouched. Working tree only per owner's recorded-demo requirement.
