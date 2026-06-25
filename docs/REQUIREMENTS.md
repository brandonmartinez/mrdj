# mrdj — Requirements (PRD v0.1)

> Authored 2026-06-23 from the project owner's project brief. This is the living source of truth for
> **what** mrdj does. Owned by Saul; update via "the PRD changed". Open decisions live in
> `.squad/decisions.md`.

---

## 1. Overview

mrdj is a **multi-tenant social jukebox marketplace** for DJs and DJ businesses running live events/parties. Guests
request songs into a DJ-controlled queue and pay (via credits) to influence playback order. It
combines a **jukebox** (crowd picks the music, pay to prioritize) with a **live DJ** (the
DJ curates and stays in control), while each DJ tenant can run its own events and get paid out.

## 2. Personas & Roles

| Role | Account? | What they can do |
|------|----------|------------------|
| **Guest** | No account required | Join an event, browse/search, request songs, buy Organization-scoped credits, bump (Up Next), purchase Play Next |
| **Account holder** | Google SSO | Everything a guest can do, plus a persistent identity, Organization-scoped credit balances, and history |
| **Organization** | Tenant | The DJ business; a solo DJ is an Organization of one. Owns its Stripe Connect account, events, pricing, credit bundles, and member roster |
| **Membership** | Google SSO | User↔Organization link carrying an org role: `owner`, `manager`, `dj` (lead DJ), or `staff` |
| **Owner / Manager** | Membership | Manage Organization settings, Stripe Connect onboarding, default pricing, credit bundles, Membership roles, and events; email invites are post-beta |
| **DJ** | Membership | Lead DJ for assigned events; manage Area queues, playback order, Play Next, and event operations |
| **Staff** | Membership | Help run assigned event operations with limited permissions |
| **Platform Admin** | Operator | SaaS operator role for oversight, support, tenant health, and marketplace operations; distinct from any org role |

The old global DJ administrator assumption is replaced by Organization-scoped Membership roles. A lead DJ is a `dj` Membership in an Organization, not a global administrator.

## 3. Core Concepts

- **Organization** — the tenant ("DJ business"; a solo DJ is an Organization of one). Owns its Stripe Connect account, events, pricing, credit bundles, and member roster.
- **Membership** — a user↔Organization link carrying an org role: `owner` | `manager` | `dj` (lead DJ) | `staff`.
- **Event** — belongs to exactly one Organization, may carry a lead DJ assignment, and may run concurrently with other events in the same Organization. Explicit lead-DJ selection in the admin UI is post-beta.
- **Area** — optional subdivision of an Event (zone/stage). Every Event has at least one default Area; single-area events are just an Event with one Area.
- **Queue** — the ordered list of requested songs for an Area. One authoritative state per Area.
- **Request** — a guest adding a song to an Area queue (free or low-cost — Open Decision O2).
- **Credits / Wallet** — the spend currency. Guests buy credits with real money; actions debit credits. MVP credits are recommended to be Organization-scoped (O8).
- **Up Next** — a paid bump that moves a request toward the top of an Area queue.
- **Play Next** — the premium, single-slot bump for an Area (see §4.5 for exact rules).
- **Track** — a normalized, provider-agnostic song object. MVP live search uses the iTunes Search API; Apple Music and Spotify remain post-MVP provider roadmap items behind the same model.

Tenant-scoped data should carry `organization_id` where relevant so Organization data remains isolated.

## 4. Functional Requirements

### 4.1 Guest onboarding
- A guest can join an event without creating an account (link/QR → in).
- Optional sign-in via **Google SSO** to persist identity and Organization-scoped credits.
- Guests get a lightweight session identity sufficient to attribute requests and credit balance within the Organization/event context.

### 4.2 Organization onboarding & Memberships
- A DJ can self-serve sign up and create an **Organization**.
- Organization owners/managers can manage Membership roles: `owner`, `manager`, `dj`, `staff`. Email/member invite UX is deferred post-beta (#109).
- Member access is scoped to the Organization; Platform Admin permissions are separate from org roles.
- Organization data is isolated by `organization_id` where relevant.

### 4.3 Event and Area setup
- Owners/managers can create and manage Events under an Organization. Explicit lead-DJ selection during event creation is deferred post-beta (#109).
- Multiple Events in the same Organization may run concurrently.
- Every Event has at least one default Area.
- Event setup can add multiple Areas for large events split into zones/stages.
- Each Area owns its own queue and Play Next slot.

### 4.4 Song discovery & request
- Search the catalog by title/artist; see artwork and metadata.
- **MVP/beta provider:** iTunes Search API is the shipped live provider. Apple Music and Spotify are deferred post-MVP integrations because Apple Music requires a paid developer key and Spotify Web API access now requires Premium; track as #17 and #22.
- Add a selected track to an Area queue as a **Request**.
- Normal requests are free or low-cost (**O2**). Abuse controls/rate limits apply to guests.

### 4.5 Credits / wallet (primary spend)
- Guests purchase **credits** with real money (credit packs/upsell).
- Credit balance is always visible in the UI.
- All paid actions debit credits; credits are granted **only after** server-side payment verification.
- MVP credits are Organization-scoped (**O8**): credits bought for Organization A are not portable to Organization B.

### 4.6 Bump to Up Next (paid)
- A guest spends credits to move their request up toward the front of the Area queue (**Up Next**).
- Pricing is server-authoritative. The bump reorders the authoritative Area queue transactionally.

### 4.7 Play Next (premium) — exact rules
- **Play Next** is the premium spot: the bumped song plays *next* in its Area.
- **Only ONE** Play Next is purchasable per Area at any given time.
- It is **not always available**.
- After the Play-Next'd song **has played**, the Area's slot **resets** and becomes available to purchase again.
- Costs **more** than a normal Up Next bump.
- Implemented as a single-resource lock in the backend state machine (Basher); availability is server-truth.

### 4.8 DJ console
- Real-time view of the assigned Area queue(s) (updates as guests request/bump).
- Reorder, approve/reject, and remove requests; see each Area's current Play Next holder.
- Control playback order; mark the current/now-playing track (drives the Play Next reset for that Area).
- Visibility into requests and spend for the event and Area.

### 4.9 Auth & access control
- Guest sessions (no account) + **Google SSO** for accounts.
- Organization Membership roles provide org-scoped permissions (RBAC). Privileged actions are authorized server-side.
- Platform Admin is a separate SaaS operator role, not an Organization Membership role.

### 4.10 Stripe Connect onboarding & payouts
- Each Organization owns a Stripe connected account.
- DJ signup/Organization setup includes Stripe Connect onboarding.
- An Organization cannot accept paid actions until its connected account is enabled (**O14**).
- Guest credit purchases pay the platform; the platform takes an application fee and the remainder is paid out to the Organization's connected account.

### 4.11 Per-Organization pricing & bundles
- Owners/managers can manage Organization pricing and credit bundles using platform default action pricing as the beta baseline (**O9**).
- Beta scope includes credit-bundle management with zero-credit bundle validation; per-action price configuration UI for `queue`, `boost`, and `play_next` is deferred post-beta (#109).
- Pricing remains server-authoritative for all paid actions.

### 4.12 Platform Admin surface
- Platform Admin can view Organizations, connected-account status, payment health, tenant support context, and high-level marketplace operations.
- Platform Admin can assist with operational issues without becoming an org role.

## 5. Monetization Model

- **Marketplace via Stripe Connect** (D7): guest pays the platform for credits, the platform takes a **% application fee** (**O11**), and the remainder is paid out to the Organization's Stripe connected account.
- Each **Organization** is a Stripe connected account; **Connect Express** is the recommended MVP account type (**O10**).
- **Credits-first** remains the product model: real money → Organization-scoped credits → spend on Up Next and Play Next.
- Credits are Organization-scoped (**O8**): credits bought for Organization A are not portable to Organization B.
- Normal request cost (free vs low-cost) is **O2**, to be decided with pricing.
- Optional DJ subscription tiers are deferred (**O16**); they are not required for MVP marketplace monetization.

## 6. Payments (constraints — Stripe Connect marketplace)

- **Locked direction:** Stripe Connect marketplace with Organization connected accounts (D7).
- **Hard requirements:**
  - Raw card data never touches our servers (hosted fields / hosted checkout).
  - Purchases verified via **webhook** before credits are granted.
  - **Idempotency** on every purchase; safe under retries and replays.
  - **Per-tenant idempotency**: idempotency keys and credit grants are scoped so one Organization's retries cannot affect another Organization.
  - Application fees are captured on credit purchases (**O11**).
  - Connected-account onboarding/KYC gates paid actions; an Organization cannot accept paid actions until enabled (**O14**).
  - Payouts/transfers route the post-fee remainder to the Organization's connected account.
  - Designed for **refunds and chargebacks/disputes**.
  - Mobile-first checkout UX.

## 7. Music Integration

- **MVP/beta provider:** integrate the **iTunes Search API** as the only live music provider for search/resolve/metadata.
- Keep a normalized **`Track`** abstraction so the queue and UI are provider-agnostic and Apple Music/Spotify can be added cleanly later.
- **Post-MVP / deferred:** Apple Music (MusicKit) and Spotify Web API. Apple Music requires a paid developer key (#17); Spotify Web API access requires Premium (#22).
- Provider tokens stay server-side; respect rate limits; cache lookups; degrade gracefully.
- O6 is resolved for MVP as iTunes-first; multi-provider support remains roadmap scope.

## 8. Non-Functional Requirements

- **Responsive:** excellent on **mobile and desktop**; big, visual, jukebox-style.
- **Realtime:** Area queue updates propagate to guests and DJ near-instantly (SSE chosen in slice-02 for current shipped path; future scaling may revisit broker details).
- **Security:** server-authoritative money paths; RBAC; Organization data isolation; input validation; guest abuse/rate limiting; no secrets in git.
- **Reliability:** no double-charge/double-grant; transactional spends; idempotent endpoints.
- **Availability:** constrained beta may run as a single replica while sessions/realtime are process-local; 2+ replicas, HPA, and shared session/realtime fan-out are post-beta hardening before broader launch.
- **Observability:** health endpoint, logs, and (later) metrics suitable for the cluster's Prometheus/Grafana.

## 9. Deployment & Infrastructure

Deploy to the project owner's **k3s** cluster, mirroring a proven reference app already running on the same cluster:

- Container image published to **GHCR**: `ghcr.io/brandonmartinez/mrdj`.
- **Kustomize** bundle: namespace, deployment, service, ingress, HPA, PDB.
- **Deployment:** `/api/health` startup/readiness/liveness probes; resource requests/limits; topology spread across nodes.
- **Ingress:** Traefik ingressClass, cert-manager `letsencrypt-prod`, HTTPS-redirect middleware, host `mrdj.${NETWORK_HOSTNAME_SUFFIX}` → `mrdj.themartinez.cloud`, TLS secret.
- **Scaling:** constrained beta runs single-replica unless shared sessions/realtime fan-out are completed; HPA min 2 / max 3 and PDB minAvailable 1 are the post-beta HA target.
- **Config:** configMap + secret generators from `.env` files; **no secrets in git**.
- **Data:** likely the cluster's shared **PostgreSQL** (`data` resource: Postgres + PgBouncer) — confirm (relates to O5: where manifests live).

## 10. MVP Scope

**In:** guest access, Google SSO, DJ self-serve signup, Organization creation, Memberships/roles (`owner`, `manager`, `dj`, `staff`), manager-managed org Events/Areas, default Area per Event, multi-Area events with per-Area queue + Play Next, **iTunes Search API music discovery**, request-to-queue, Organization-scoped credits purchase, paid Up Next, premium Play Next (single-slot + reset per Area), area-scoped DJ console with correct `areaId`, Stripe Connect Express onboarding + payouts, per-Organization pricing/bundles with platform default action pricing, zero-credit bundle validation, Platform Admin surface, constrained k3s beta deploy.

**Out (now):** Apple Music (#17) and Spotify (#22) providers, email/member invite UX (#109), explicit lead-DJ selection UI (#109), per-action price configuration UI (#109), Serato, deeper Now-Playing, live remix, native apps, extra SSO providers, subscription tiers, subdomain routing, Postgres RLS, multi-replica HA until shared sessions/realtime are implemented.

## 10.1 MVP scope / beta limitations

The launchable beta is intentionally constrained: one live music provider (iTunes Search API), single-replica operation unless shared sessions/realtime are completed, and paid-anonymous usage only after unique guest identity and Stripe smoke/reconciliation are proven. These constraints are product scope, not the long-term vision.

## 10.2 Deferred from beta (#109)

The 2026-06-24 product review identified admin-UX gaps. For beta, ship the low-cost safety/accuracy fixes (zero-credit bundle validation and hiding the development role-switch) plus the area-scoped DJ console work; defer email/member invites, lead-DJ selection UI, and per-action price configuration UI to post-beta backlog.

## 11. Backlog / Future Ideas (capture only)

- **Serato integration** (DJ software).
- **Now-Playing** integration (richer, beyond MVP basics).
- **Live remix** of two songs requested by savvy guests — an upcharge feature.
- **Optional DJ subscription tiers** (defer; O16).
- **Subdomain tenant routing** (defer; O12 recommends path-based for MVP).
- **Postgres RLS** as a later hardening option (O13 recommends app-level scoping for MVP).
- **Post-beta admin UX from #109:** email/member invites, explicit lead-DJ selection UI, and per-action price configuration UI.

## 12. Open Decisions

Tracked in `.squad/decisions.md`:

| ID | Decision | Owner |
|----|----------|-------|
| O1 | Payment provider (Stripe/PayPal/Amazon Pay/…) — **high priority** | Frank |
| O2 | Normal request: free vs low-cost | Saul + Frank |
| O3 | Realtime transport: WebSocket vs SSE | Basher |
| O4 | Add a dedicated QA agent? | Squad + the project owner |
| O5 | k8s manifests location: this repo vs cluster repo | Virgil |
| O6 | Music MVP scope: **resolved for MVP as iTunes Search API first**; Apple Music (#17) and Spotify (#22) deferred post-MVP | Livingston + Saul |
| O7 | Refund / dispute policy | Frank + Saul |
| O8 | Credit/wallet scope — recommend Organization-scoped | Frank + Rusty |
| O9 | Per-Organization pricing + credit bundles — recommend per-org with platform defaults | Frank + Saul |
| O10 | Stripe Connect account type — recommend Express | Frank |
| O11 | Platform-fee model — recommend % application fee on credit purchases | Frank + Saul |
| O12 | Tenant routing — path `/o/{slug}` vs subdomain — recommend path-based for MVP | Rusty + Linus |
| O13 | Data-isolation enforcement — app-level scoping vs Postgres RLS — recommend app-level for MVP | Rusty + Basher |
| O14 | DJ onboarding/KYC flow — recommend Connect Express hosted onboarding; Organization can't accept paid actions until connected account is enabled | Frank + Saul |
| O15 | Single-tenant → multi-tenant data migration/backfill — recommend default Organization + default Area backfill | Basher + Rusty |
| O16 | Optional DJ subscription tiers later — recommend defer | Saul |

## 13. Success Metrics (later)

- Time-to-first-request for a new guest (target: seconds, on mobile).
- Credit purchase conversion and average spend per event.
- Play Next sell-through by Area (how often the premium slot is bought when available).
- Successful DJ self-serve onboarding rate: signup → Organization → Connect enabled → first live event.
- Zero money-handling defects (double-charge/grant, wrong Organization payout) in production.
