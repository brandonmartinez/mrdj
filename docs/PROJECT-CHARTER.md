# mrdj — Project Charter

> A social jukebox for DJs. Guests request songs into the DJ's live
> queue and pay to influence what plays next — a jukebox **+** a live DJ.

## Vision

Bring the magic of a paid jukebox to live DJ sets and events. Guests (no app, no
account required) browse a catalog backed by Apple Music and Spotify, request songs
into the DJ's queue, and — when they really want to hear something — spend credits to
**bump** their song up or grab the single premium **Play Next** slot. The DJ stays in
control through an admin console; the crowd gets agency and a little friendly competition.

## Mission

Ship a focused, reliable MVP that runs on the project owner's k3s cluster at
`mrdj.themartinez.cloud`, handles real money safely via a credits/wallet model, and
feels great on a phone in a dark room.

## Goals

1. **Guest-first.** Zero-friction entry — scan/visit, browse, request. No account needed.
2. **Monetize cleanly.** Credits/wallet as the primary spend; paid Up Next and premium Play Next.
3. **DJ in control.** An admin console to manage, reorder, approve, and play the queue.
4. **Provider-agnostic music.** Apple Music + Spotify behind one normalized Track model.
5. **Boring, reliable ops.** Mirror a proven k3s deployment pattern from an existing app on the same cluster.
6. **Build via the loop.** Iterative loop-engineering workflow with a maker/checker split.

## Success Criteria (MVP)

- A guest can join an event, search a song, and add it to the queue from a phone.
- A guest can buy credits and use them to bump a song to **Up Next**.
- A guest can purchase the single **Play Next** slot when available; it resets after the bumped song plays.
- A DJ can see the live queue update in real time and manage playback order.
- Real-money purchases are verified server-side and never double-credited.
- The app is deployed to k3s behind TLS at `mrdj.themartinez.cloud`.

## Scope

**In (MVP):** guest access, account via Google SSO, admin/DJ role, song discovery
(Apple Music + Spotify), request-to-queue, credits/wallet purchase, paid Up Next, premium
Play Next (single-slot, resets), real-time DJ console, k3s deployment.

**Out (backlog — captured, not built):** Serato integration, deeper Now-Playing
integration, live remix of two requested songs (upcharge), native mobile apps, multi-tenant
SaaS, additional SSO providers beyond Google.

## Engineering Principles

- **SOLID, DRY, YAGNI** throughout.
- **Reusable components** on the frontend (control interfaces, queue, credits).
- **Server-authoritative** pricing, availability, and credit grants. Never trust the client about money.
- **Idempotent & transactional** money paths. No double-charge, no double-grant, no replay.
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
