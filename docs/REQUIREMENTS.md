# mrdj — Requirements (PRD v0.1)

> Authored 2026-06-23 from the project owner's project brief. This is the living source of truth for
> **what** mrdj does. Owned by Saul; update via "the PRD changed". Open decisions live in
> `.squad/decisions.md`.

---

## 1. Overview

mrdj is a **social jukebox** for DJs running live events/parties. Guests
request songs into the DJ's queue and pay (via credits) to influence playback order. It
combines a **jukebox** (crowd picks the music, pay to prioritize) with a **live DJ** (the
DJ curates and stays in control).

## 2. Personas & Roles

| Role | Account? | What they can do |
|------|----------|------------------|
| **Guest** | No account required | Join an event, browse/search, request songs, buy credits, bump (Up Next), purchase Play Next |
| **Account holder** | Google SSO | Everything a guest can do, plus a persistent identity, credit balance, and history |
| **Admin / DJ** | Elevated | Manage the queue (reorder, approve/reject, remove), control playback, see requests & spend, run the event |

## 3. Core Concepts

- **Event** — a DJ session guests join (e.g., via a link/QR code). Scopes the queue and Play Next slot.
- **Queue** — the ordered list of requested songs for an event. One authoritative state.
- **Request** — a guest adding a song to the queue (free or low-cost — Open Decision O2).
- **Credits / Wallet** — the spend currency. Guests buy credits with real money; actions debit credits.
- **Up Next** — a paid bump that moves a request toward the top of the queue.
- **Play Next** — the premium, single-slot bump (see §4.5 for exact rules).
- **Track** — a normalized, provider-agnostic song object (Apple Music or Spotify under the hood).

## 4. Functional Requirements

### 4.1 Guest onboarding
- A guest can join an event without creating an account (link/QR → in).
- Optional sign-in via **Google SSO** to persist identity and credits.
- Guests get a lightweight session identity sufficient to attribute requests and credit balance.

### 4.2 Song discovery & request
- Search the catalog (Apple Music + Spotify) by title/artist; see artwork and metadata.
- Add a selected track to the event queue as a **Request**.
- Normal requests are free or low-cost (**O2**). Abuse controls/rate limits apply to guests.

### 4.3 Credits / wallet (primary spend)
- Guests purchase **credits** with real money (credit packs/upsell).
- Credit balance is always visible in the UI.
- All paid actions debit credits; credits are granted **only after** server-side payment verification.

### 4.4 Bump to Up Next (paid)
- A guest spends credits to move their request up toward the front (**Up Next**).
- Pricing is server-authoritative. The bump reorders the authoritative queue transactionally.

### 4.5 Play Next (premium) — exact rules
- **Play Next** is the premium spot: the bumped song plays *next*.
- **Only ONE** Play Next is purchasable at any given time.
- It is **not always available**.
- After the Play-Next'd song **has played**, the slot **resets** and becomes available to purchase again.
- Costs **more** than a normal Up Next bump.
- Implemented as a single-resource lock in the backend state machine (Basher); availability is server-truth.

### 4.6 DJ / Admin console
- Real-time view of the queue (updates as guests request/bump).
- Reorder, approve/reject, and remove requests; see the current Play Next holder.
- Control playback order; mark the current/now-playing track (drives the Play Next reset).
- Visibility into requests and spend for the event.

### 4.7 Auth & access control
- Guest sessions (no account) + **Google SSO** for accounts.
- **Admin** role with elevated permissions (RBAC). Admin actions are authorized server-side.

## 5. Monetization Model

- **Credits-first** (better upsell, lower per-transaction fees than pay-per-song).
- Real money → credits → spend on Up Next and Play Next.
- Normal request cost (free vs low-cost) is **O2**, to be decided with pricing.

## 6. Payments (constraints — provider is Open Decision O1)

- **Provider undecided:** Stripe vs PayPal vs Amazon Pay vs others. Frank delivers a recommendation with a tradeoff table (fees, credits/wallet fit, mobile UX, payout, dispute handling, integration effort).
- **Hard requirements regardless of provider:**
  - Raw card data never touches our servers (hosted fields / hosted checkout).
  - Purchases verified via **webhook** before credits are granted.
  - **Idempotency** on every purchase; safe under retries and replays.
  - Designed for **refunds and chargebacks/disputes**.
  - Mobile-first checkout UX.

## 7. Music Integration

- Integrate **Apple Music (MusicKit)** and **Spotify Web API**.
- A normalized **`Track`** abstraction (search/resolve/metadata) so the queue and UI are provider-agnostic.
- Provider tokens stay server-side; respect rate limits; cache lookups; degrade gracefully.
- MVP provider scope (both vs one first) is **O6**.

## 8. Non-Functional Requirements

- **Responsive:** excellent on **mobile and desktop**; big, visual, jukebox-style.
- **Realtime:** queue updates propagate to guests and DJ near-instantly (WebSocket vs SSE — **O3**).
- **Security:** server-authoritative money paths; RBAC; input validation; guest abuse/rate limiting; no secrets in git.
- **Reliability:** no double-charge/double-grant; transactional spends; idempotent endpoints.
- **Availability:** 2+ replicas, HPA, PDB; health checks for k8s probes.
- **Observability:** health endpoint, logs, and (later) metrics suitable for the cluster's Prometheus/Grafana.

## 9. Deployment & Infrastructure

Deploy to the project owner's **k3s** cluster, mirroring a proven reference app already running on the same cluster:

- Container image published to **GHCR**: `ghcr.io/brandonmartinez/mrdj`.
- **Kustomize** bundle: namespace, deployment, service, ingress, HPA, PDB.
- **Deployment:** `/api/health` startup/readiness/liveness probes; resource requests/limits; topology spread across nodes.
- **Ingress:** Traefik ingressClass, cert-manager `letsencrypt-prod`, HTTPS-redirect middleware, host `mrdj.${NETWORK_HOSTNAME_SUFFIX}` → `mrdj.themartinez.cloud`, TLS secret.
- **Scaling:** HPA min 2 / max 3 (CPU target ~60%); PDB minAvailable 1.
- **Config:** configMap + secret generators from `.env` files; **no secrets in git**.
- **Data:** likely the cluster's shared **PostgreSQL** (`data` resource: Postgres + PgBouncer) — confirm (relates to O5: where manifests live).

## 10. MVP Scope

**In:** guest access, Google SSO, admin/DJ role, Apple Music + Spotify search, request-to-queue,
credits purchase, paid Up Next, premium Play Next (single-slot + reset), realtime DJ console, k3s deploy.

**Out (now):** Serato, deeper Now-Playing, live remix, native apps, multi-tenant SaaS, extra SSO providers.

## 11. Backlog / Future Ideas (capture only)

- **Serato integration** (DJ software).
- **Now-Playing** integration (richer, beyond MVP basics).
- **Live remix** of two songs requested by savvy guests — an upcharge feature.

## 12. Open Decisions

Tracked in `.squad/decisions.md`:

| ID | Decision | Owner |
|----|----------|-------|
| O1 | Payment provider (Stripe/PayPal/Amazon Pay/…) — **high priority** | Frank |
| O2 | Normal request: free vs low-cost | Saul + Frank |
| O3 | Realtime transport: WebSocket vs SSE | Basher |
| O4 | Add a dedicated QA agent? | Squad + the project owner |
| O5 | k8s manifests location: this repo vs cluster repo | Virgil |
| O6 | Music MVP scope: both providers vs one first | Livingston + Saul |

## 13. Success Metrics (later)

- Time-to-first-request for a new guest (target: seconds, on mobile).
- Credit purchase conversion and average spend per event.
- Play Next sell-through (how often the premium slot is bought when available).
- Zero money-handling defects (double-charge/grant) in production.
