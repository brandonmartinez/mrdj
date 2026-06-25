# mrdj — Project Charter

> A multi-tenant social jukebox marketplace for DJs. Guests request songs into the DJ's live
> queue and pay to influence what plays next — a jukebox **+** a live DJ.

## Vision

Bring the magic of a paid jukebox to live DJ sets and events, as a **multi-tenant marketplace SaaS for DJs & DJ businesses**. DJs sign up, create an Organization, run their own events, and get paid out via Stripe Connect minus a platform fee. Guests (no app, no account required) browse a catalog backed in the MVP by the iTunes Search API, request songs into an Area queue, and — when they really want to hear something — spend credits to **bump** their song up or grab that Area's premium **Play Next** slot. Apple Music and Spotify remain post-MVP provider roadmap items. The DJ stays in control through an org-scoped console; the crowd gets agency and a little friendly competition.

## Mission

Ship a focused, reliable MVP that runs on the project owner's k3s cluster at
`mrdj.themartinez.cloud`, lets DJs and DJ businesses self-serve their own Organizations and events, handles real money safely via a Stripe Connect credits/wallet marketplace, and feels great on a phone in a dark room.

## Goals

1. **Guest-first.** Zero-friction entry — scan/visit, browse, request. No account needed.
2. **Monetize cleanly.** Credits/wallet as the primary spend; paid Up Next and premium Play Next.
3. **DJ in control.** An Organization-scoped console to manage, reorder, approve, and play Area queues.
4. **Multi-tenant by default.** Organizations own events, members, pricing, credit bundles, and payouts.
5. **Provider-agnostic music.** iTunes Search API for MVP, with Apple Music + Spotify deferred behind one normalized Track model.
6. **Boring, reliable ops.** Mirror a proven k3s deployment pattern from an existing app on the same cluster.
7. **Build via the loop.** Iterative loop-engineering workflow with a maker/checker split.

## Success Criteria (MVP)

- A guest can join an event, search a song, and add it to the correct Area queue from a phone.
- A guest can buy Organization-scoped credits and use them to bump a song to **Up Next**.
- A guest can purchase the single **Play Next** slot for an Area when available; it resets after the bumped song plays.
- A DJ can self-serve sign up, create an Organization, onboard via Stripe Connect, and create an Event with at least one Area.
- A DJ can see the live Area queue update in real time and manage playback order.
- A guest's purchase is split via a platform application fee, with the remainder destined to the Organization's connected account.
- Organization data is isolated by `organization_id` where relevant.
- Real-money purchases are verified server-side and never double-credited.
- The app is deployed to k3s behind TLS at `mrdj.themartinez.cloud`.

## Scope

**In (MVP):** guest access, account via Google SSO, DJ self-serve signup, Organizations, Membership roles (`owner`, `manager`, `dj`, `staff`), org-owned concurrent events, event Areas with per-Area queue + Play Next, song discovery via the iTunes Search API, request-to-queue, Organization-scoped credits/wallet purchase, paid Up Next, premium Play Next (single-slot per Area, resets), realtime DJ console, Stripe Connect Express onboarding + payouts with platform fee, per-Organization pricing/credit bundles with platform defaults, constrained k3s beta deployment, Platform Admin surface.

**Out (backlog — captured, not built):** Apple Music (#17) and Spotify (#22) providers, Serato integration, deeper Now-Playing
integration, live remix of two requested songs (upcharge), native mobile apps, additional SSO providers beyond Google, optional DJ subscription tiers, subdomain tenant routing, Postgres RLS.

## Engineering Principles

- **SOLID, DRY, YAGNI** throughout.
- **Reusable components** on the frontend (control interfaces, queue, credits).
- **Server-authoritative** pricing, availability, and credit grants. Never trust the client about money.
- **Idempotent & transactional** money paths. No double-charge, no double-grant, no replay.
- **Organization isolation** on tenant-scoped data and actions.
- **Provider abstraction** for music so no single API can hold the product hostage.
- **Secrets never in git.** 12-factor config via env (configMap + secret).

## Team

Cast from **Ocean's Eleven** (`asg-mrdj-20260623-001`). See `.squad/team.md`.

| Member | Role |
|--------|------|
| Rusty | Lead / Architect (reviewer gate) |
| Linus | Frontend Engineer (React/Tailwind) |
| Basher | Backend Engineer (Node/Postgres/auth) |
| Frank | Payments Engineer (credits/provider) |
| Livingston | Music Integration (Apple Music/Spotify) |
| Virgil | DevOps / Platform (k3s) |
| Saul | Product / Requirements |
| Scribe | Session logger (silent) |
| Ralph | Work monitor |
| Rai | Responsible-AI reviewer |

## Governance

- Direction is recorded in `.squad/decisions.md` (the decision ledger).
- **Rusty** is the technical tiebreaker; **Saul** owns scope.
- Work flows through the loop (`docs/LOOP-ENGINEERING.md`): the implementer makes, **Rusty** reviews/gates, **Rai** checks safety.

## Reference Links

- Product reference: classic touchscreen bar jukeboxes (crowd pays to prioritize the queue)
- Workflow: Loop Engineering — https://addyosmani.com/blog/loop-engineering/
- Deployment reference: an existing reference app's manifests in the cluster infrastructure repo
- Requirements: `docs/REQUIREMENTS.md`
