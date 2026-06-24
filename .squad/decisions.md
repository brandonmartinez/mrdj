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

## Active Decisions (Decided)

### 2026-06-23 — A1: Architecture baseline v0 (MVP)
**Decision:** Core entities (User, Event, Queue, QueueItem, Track, Wallet, CreditTransaction, PlayNextSlot) defined. Play Next state machine: `available` → `locked` → `cooldown` → `available`; single purchasable at a time; resets AFTER bumped song plays; concurrency via row-level lock. Credits-ledger contract seam named `CreditsService` (idempotent, append-only). Up Next vs Play Next distinguished. Module layout: identity, event, queue, credits, payments, music, realtime, admin.
**By:** Rusty (architect). **Owners:** Rusty, Basher (queue/state machine), Frank (credits ledger consumer).
**Touches:** O2 (normal request cost — free or low-cost, pricing config drives spend), O6 (Track abstraction is provider-agnostic, MVP scope TBD), O3 (framed but owned by Basher).
**Doc:** `docs/ARCHITECTURE.md`

### 2026-06-23 — A2: Infrastructure confirmations
**Decision:** (a) `${NETWORK_HOSTNAME_SUFFIX}=themartinez.cloud` confirmed; mrdj ingress resolves to `https://mrdj.themartinez.cloud`. (b) **Shared PostgreSQL via PgBouncer (transaction pooling) at `postgres-svc.data.svc.cluster.local:5432`, database `mrdj` created via postgres-init ConfigMap.** Connection string: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres-svc.data.svc.cluster.local:5432/mrdj`. Database provisioning: add `init-mrdj-db.sh` to the cluster's shared-database `postgres-init` ConfigMap (data namespace).
**By:** Virgil (DevOps). **Owner:** Virgil (infra), Basher (DB driver/ORM confirmation).
**Follow-up from Basher:** Confirm Node.js DB driver (Prisma/TypeORM/Sequelize/pg) and PgBouncer transaction-pooling compatibility.
**Doc:** `k8s/` skeleton (this repo).

## Open Decisions (Need Resolution)

### O1 — Payment provider — HIGH PRIORITY ⏳
**Question:** Stripe vs PayPal vs Amazon Pay vs others for the credits/wallet model?
**Recommendation (2026-06-23, Frank):** **Stripe**. Native idempotency headers (critical for retry-safe, server-authoritative credit grant flow), best-in-class webhooks, mobile-first checkout via Payment Element (Apple Pay/Google Pay), excellent Node.js SDK. PCI SAQ-A scope (no raw card data on servers). Credits/wallet model maps cleanly to Payment Intents. Transaction fees 2.9% + $0.30 manageable with credit-pack sizing ($5/$10/$20). **Status:** PROPOSED — pending the project owner's confirmation.
**Owner:** Frank (payments/credits), Basher (ledger interface), Linus (checkout UX). **Input:** Saul (product).
**Doc:** `docs/decisions/payments-provider.md`

### O2 — Normal request cost ⏳
**Question:** Is adding a normal request free or low-cost? Affects pricing and abuse control.
**Owner:** Saul + Frank. **Status:** OPEN.

### O3 — Realtime transport ⏳
**Question:** WebSocket vs SSE for live queue sync between guests and the DJ console?
**Framing (A1):** Architecture leans SSE for simplicity given mostly server→client fan-out shape, but Basher owns the final call based on bidirectionality needs and ops comfort.
**Owner:** Basher. **Status:** OPEN.

### O4 — Dedicated QA agent? ⏳
**Question:** Add a dedicated Tester/QA agent now, or keep testing as an implementer-owned discipline gated by Rusty (current default)?
**Owner:** Squad + the project owner. **Status:** OPEN — defaulting to implementer-owned + review gate for MVP. Casting headroom exists (Ocean's Eleven, capacity 14).

### O5 — Where do mrdj k8s manifests live? ⏳
**Question:** In this repo (`mrdj/k8s/`) or in the cluster infrastructure repo alongside the reference app?
**Recommendation (2026-06-23, Virgil):** **Cluster repo canonical** (the cluster infrastructure repo, under its mrdj resource path). Rationale: single source of truth for cluster state (already proven with the reference app), clean separation (app code in mrdj repo, deployment in cluster repo), straightforward promotion workflow (author skeleton in `mrdj/k8s/`, validate, copy to cluster repo post-launch). Secret management via cluster repo gitignored `.env.secret.temp` files. **Status:** PROPOSED — pending the project owner / Squad confirmation.
**Owner:** Virgil (infra). 
**Doc:** Skeleton in `k8s/` (this repo); promotion documented in virgil-infra-confirmations.md.

### O6 — Music provider MVP scope ⏳
**Question:** Launch with both Apple Music AND Spotify, or one first behind a normalized Track abstraction?
**Owner:** Livingston + Saul. **Status:** OPEN.

### O7 — Refund / dispute policy ⏳
**Question:** How are credits and Play Next purchases refunded? When? Who gets a refund?
**Proposal (2026-06-23, Rai):** (1) **Auto-refund for DJ-skipped Play Next:** If DJ skips/rejects a paid Play Next song before it plays, guest receives full refund to credit balance (automated, no guest request). Owner: Basher (DJ skip trigger) + Frank (refund ledger). (2) **Unused credits refund window:** Account holders can request refund for unused credits within 30 days of purchase (email support, or in-app later). Guest sessions: non-refundable, disclosed at checkout. Owner: Frank (policy docs) + Basher (session logic). (3) **Refund policy UI:** Link from checkout, profile, FAQ — example: "Account holders: refundable within 30 days. Guests: non-refundable, expire when event ends. DJ skips Play Next? Auto-refunded to your balance. Chargebacks may result in account suspension." Owner: Linus (UI) + Frank (wording). (4) **Chargeback handling:** Stripe webhook `charge.dispute.created` → flag account for review. Clear, generous refund policy reduces chargebacks. Owner: Frank (webhook) + Basher (admin flag).
**Owner:** Frank (payments/refunds) + Saul (scope/policy). **Input:** Linus (UI), Basher (admin module). **Status:** OPEN — awaiting the project owner/Frank decision. No code yet; timely to resolve pre-integration.
**Doc:** `.squad/decisions/inbox/rai-refund-policy.md` (will be deleted after merge).
**RAI reasoning:** Fairness + transparency trust builder. Dark-pattern avoidance (non-refundable + arbitrary DJ control = scam risk). Chargeback economics: $15 fee per dispute vs $0 ledger entry for refund.

## Governance

- All meaningful changes require team consensus; **Rusty** is the technical tiebreaker, **Saul** owns scope.
- Agents propose decisions in `.squad/decisions/inbox/`; the **Scribe** merges them here.
- Keep per-agent history focused on work; keep this file focused on direction.
