# mrdj Phase 2 Roadmap

> **Owner:** Saul (Product / Requirements) · **Date:** 2026-06-24 · **Status:** Active
>
> This roadmap reflects the Phase 2 backlog pass. Technical sequencing was verified by Rusty (Lead/Architect).
> All scope and architectural anchors live in `.squad/decisions.md` (D1–D8, A1–A3, O1–O16).
> Open decisions tracked in **Epic 10 → #14** must be confirmed before the downstream epics they gate can proceed.

---

## Release Train

### v0.2.0 — Data Foundation

**Theme:** Make Drizzle ORM the typed, PgBouncer-safe data layer. This is the prerequisite for every multi-tenant schema change that follows.

**Epics**
- [#5 — Epic 1: Data layer → Drizzle (D8)](https://github.com/brandonmartinez/mrdj/issues/5)

**Exit criteria**
- All raw `pg` queries in slice-01/02 replaced by Drizzle equivalents
- `drizzle-kit generate` produces a baseline migration with no diff against the live schema
- Money-path `advanceQueue`/credit grant uses `.for('update')` via Drizzle
- `forOrg(organizationId)` stub compiled and wired (no-op pass-through)
- All slice-01/02 tests green

---

### v0.3.0 — Multi-Tenant Core + Real Auth

**Theme:** Introduce Organization/Membership/Area tenancy, enforce isolation via `forOrg`, wire real Google SSO, and close all open decision spikes.

**Epics**
- [#6 — Epic 2: Multi-tenant core (D7) — Org/Membership/Area, isolation, /o/{slug}](https://github.com/brandonmartinez/mrdj/issues/6)
- [#7 — Epic 3: Real auth — Google SSO](https://github.com/brandonmartinez/mrdj/issues/7)
- [#14 — Epic 10: Open decisions & spikes (O2, O5, O6–O16)](https://github.com/brandonmartinez/mrdj/issues/14)

**Exit criteria**
- Org, Membership, Area tables exist; all tenant rows carry `organization_id`
- All tenant queries flow through `forOrg()` seam; cross-tenant access returns 403
- O15 backfill migration assigns all existing data to the default Org/Area
- DJ can sign in via Google OAuth2; first login bootstraps Org + owner Membership
- `act-as` switcher is unreachable in production
- All O2/O5–O16 decision spikes have a documented owner recommendation

---

### v0.4.0 — Marketplace Payments

**Theme:** Wire real money via Stripe Connect Express; Connect checkout UX lands for guests.

**Epics**
- [#8 — Epic 4: Marketplace payments — Stripe Connect](https://github.com/brandonmartinez/mrdj/issues/8)
- [#11 — Epic 7: Guest experience (multi-tenant)](https://github.com/brandonmartinez/mrdj/issues/11) *(checkout UX portion — stories carry `release:v0.4.0`)*

**Exit criteria**
- DJ org completes Connect Express onboarding; `charges_enabled` gates paid actions
- Guest credit purchase creates PaymentIntent with correct application fee + destination charge
- `payment_intent.succeeded` grants credits exactly once (idempotency enforced)
- PlatformPayment ledger entry written per purchase; `organization_id`-scoped throughout
- Cross-org spend rejected 403; dispute flag sets account under review
- Stripe test-mode E2E passes

---

### v0.5.0 — iTunes Music + Beta Multi-Tenant UX

**Theme:** iTunes-backed live music behind the Track abstraction; beta-ready DJ org dashboard and org-branded guest jukebox.

**Epics**
- [#9 — Epic 5: Real music providers (O6)](https://github.com/brandonmartinez/mrdj/issues/9)
- [#10 — Epic 6: DJ / Organization experience](https://github.com/brandonmartinez/mrdj/issues/10)
- [#11 — Epic 7: Guest experience (multi-tenant)](https://github.com/brandonmartinez/mrdj/issues/11) *(branded jukebox remainder — stories carry `release:v0.5.0`)*

**Exit criteria**
- iTunes Search API end-to-end; guest can search + request a real track. Apple Music (#17) and Spotify (#22) remain post-MVP provider roadmap items.
- Manager can create Events, add Areas, manage default pricing/credit bundles with zero-credit bundle validation, and operate the `areaId`-correct per-area DJ console
- Guest can navigate to `/o/{slug}`, join an event, and see the org-branded jukebox
- Credit balance is org-scoped; area selector works for multi-area events
- Deferred from beta per #109: email/member invites, explicit lead-DJ selection UI, and per-action price configuration UI

---

### v0.6.0 — Scale + Hardening

**Theme:** Multi-replica realtime via Postgres LISTEN/NOTIFY; ship to k3s, add HPA/PDB, rate-limiting, and security sign-off.

**Epics**
- [#12 — Epic 8: Realtime at scale — LISTEN/NOTIFY](https://github.com/brandonmartinez/mrdj/issues/12)
- [#13 — Epic 9: Platform ops / deploy / hardening](https://github.com/brandonmartinez/mrdj/issues/13)

**Exit criteria**
- Two replicas both receive queue mutation events via LISTEN/NOTIFY broker
- Per-area SSE channels correctly scope events; cross-area events not leaked
- GHCR pipeline builds + publishes on every merge; `mrdj.themartinez.cloud` resolves with valid TLS
- HPA (2–3 replicas), PDB (minAvailable 1), health probes all active
- Guest rate-limiting returns 429 on burst; pre-launch security review signed off

---

### release:backlog — Future

**Theme:** Deferred ideas captured so they are not lost; none are planned for MVP.

**Epics**
- [#15 — Epic 11: Future / backlog](https://github.com/brandonmartinez/mrdj/issues/15)

**Deferred items:** email/member invites (#109), explicit lead-DJ selection UI (#109), per-action price configuration UI (#109), Serato integration, deeper Now Playing, live remix upcharge, native apps, subdomain routing (O12 later), DJ subscription tiers (O16), Apple Music (#17), Spotify (#22), multi-replica HA until shared sessions/realtime are implemented.

---

## Dependency & Sequencing

```
Epic 1 (Drizzle #5)
  ├── Epic 2 (Multi-tenant core #6)
  │     ├── Epic 3 (Google SSO #7)
  │     │     └── Epic 4 (Stripe Connect #8)
  │     │           ├── Epic 6 (DJ UX #10)
  │     │           │     └── Epic 8 (Realtime scale #12)
  │     │           └── Epic 7 (Guest UX #11)
  │     └── Epic 8 (Realtime scale #12)  [also needs #10]
  └── Epic 5 (Music providers #9)         [parallel after #5]

Epic 10 (Open decisions #14) — no blocking dependency; run concurrently
Epic 9 (Platform ops #13)    — runs after Epics 1–7 are feature-stable
Epic 11 (Backlog #15)        — no dependency; always deferred
```

**Key ordering rules:**
1. **Drizzle first** — Epic 1 is the root; nothing builds a new table until Drizzle is the typed source of truth.
2. **Multi-tenant before auth** — Epic 2 creates the Org/Membership/Area schema that Epic 3 bootstraps into.
3. **Auth before payments** — Epic 3 (Google SSO) must be in place before Epic 4 (Stripe Connect) so connected accounts are linked to real user records.
4. **Payments before full UX** — Epics 6 and 7 need Epic 4 for the Connect onboarding CTA and checkout flow.
5. **Open decisions run concurrently** — Epic 10 unblocks others; its spikes should start in v0.3.0 alongside Epics 2 and 3.

---

## Epic → Release → Owner Summary Table

| Epic | Issue | Title | Release | Owner(s) | Priority | Go-state |
|------|-------|-------|---------|----------|----------|---------|
| 1 | [#5](https://github.com/brandonmartinez/mrdj/issues/5) | Data layer → Drizzle (D8) | v0.2.0 | squad:basher | p0 | go:yes |
| 2 | [#6](https://github.com/brandonmartinez/mrdj/issues/6) | Multi-tenant core (D7) | v0.3.0 | squad:basher, squad:rusty | p0 | go:needs-research |
| 3 | [#7](https://github.com/brandonmartinez/mrdj/issues/7) | Real auth — Google SSO | v0.3.0 | squad:basher | p0 | go:yes |
| 4 | [#8](https://github.com/brandonmartinez/mrdj/issues/8) | Marketplace payments — Stripe Connect | v0.4.0 | squad:frank | p0 | go:needs-research |
| 5 | [#9](https://github.com/brandonmartinez/mrdj/issues/9) | Real music providers (O6) | v0.5.0 | squad:livingston | p1 | go:needs-research |
| 6 | [#10](https://github.com/brandonmartinez/mrdj/issues/10) | DJ / Organization experience | v0.5.0 | squad:linus, squad:basher | p1 | go:yes |
| 7 | [#11](https://github.com/brandonmartinez/mrdj/issues/11) | Guest experience (multi-tenant) | v0.4.0† | squad:linus | p1 | go:yes |
| 8 | [#12](https://github.com/brandonmartinez/mrdj/issues/12) | Realtime at scale — LISTEN/NOTIFY | v0.6.0 | squad:basher | p1 | go:needs-research |
| 9 | [#13](https://github.com/brandonmartinez/mrdj/issues/13) | Platform ops / deploy / hardening | v0.6.0 | squad:virgil, squad:rusty | p1 | go:needs-research |
| 10 | [#14](https://github.com/brandonmartinez/mrdj/issues/14) | Open decisions & spikes | v0.3.0 | squad:saul | p1 | go:needs-research |
| 11 | [#15](https://github.com/brandonmartinez/mrdj/issues/15) | Future / backlog | backlog | squad:saul | p2 | go:no |

> † Epic 7 checkout UX targets v0.4.0; branded jukebox remainder targets v0.5.0 — individual stories carry their own `release:` label.
