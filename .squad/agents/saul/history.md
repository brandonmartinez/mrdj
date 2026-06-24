# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: MVP spine = request a song → buy credits → bump to Up Next → premium Play Next → DJ queue/console. Guest access needs no account; accounts via Google SSO; Admin (DJ) role manages the queue.
- 2026-06-23: Backlog (capture, do NOT build now): Serato integration, deeper Now-Playing, live remix of two requested songs (upcharge). Keep these out of MVP scope.
- 2026-06-23: Workflow is loop-engineering (addyosmani.com/blog/loop-engineering). Squad primitives map onto it — Ralph = automation heartbeat, worktrees, skills, MCP, sub-agents, decisions.md = memory.

## 2026-06-23 Loop Round 1 — O7 Co-Ownership + Privacy Policy Handoff

**Loop workstream:** Payments (O1, O7), Architecture baseline (A1), RAI advisory pass.

**O7 — Refund / dispute policy (CO-OWNED WITH FRANK):**
- **New open decision** created by Rai (RAI reviewer) during fairness pass.
- **What it covers:**
  1. Auto-refund for DJ-skipped Play Next (automated, no guest request, Frank webhook trigger → Basher admin action)
  2. 30-day refund window for unused account-holder credits (guests non-refundable, disclosed at checkout)
  3. Refund policy UI link (checkout, profile, FAQ — Linus to design)
  4. Chargeback handling (Stripe webhook flag + admin review)
- **Your scope:** Product policy definition + process (co-owned with Frank). Does auto-refund feel fair? 30-day window aligned with business goals? Chargeback handling severity (suspension on repeated chargebacks?). This touches O2 (normal request cost) — pricing strategy influences refund/chargeback likelihood.
- **Status:** OPEN — awaiting the project owner/Frank decision. Ready to finalize scope once Frank confirms O1 (Stripe).

**Privacy policy (PRE-LAUNCH REQUIREMENT):**
- **Action:** Write privacy policy for Google SSO + guest analytics (if any). Required before soft launch.
- **Why:** Google SSO PII handling must be documented. Guests need to know what data is collected and how it's used (even for non-account guests).
- **Coordination:** Link from login page (Linus), review with legal/the project owner if needed.
- **Timeline:** Needed before payment integration (O1 confirms Stripe); ready to draft now.

**Relations to O2 (normal request cost):**
- Pricing impacts refund/chargeback rates. If requests are too expensive, expect more disputes. O7 (refund policy) and O2 (pricing) should be decided together for coherence.

**Status:** O7 co-ownership confirmed. Privacy policy identified as pre-launch blocker. No blockers to starting. Ready to draft privacy policy now; O7 scope to finalize post-O1 confirmation.

## 2026-06-23 — Slice-01 Acceptance Spec

Wrote `docs/slice-01-acceptance.md`: 13 Given/When/Then scenarios (S-01–S-13), 10 money-correctness checks (MC-01–MC-10), a 16-step manual smoke-test script, and a 33-item traceability checklist mapping REQUIREMENTS.md to scenarios. Built against D6 (action labels Add to Queue / Boost / Play Next, stub payments/music, polling realtime, Cover Flow CSS transforms). Out-of-scope list explicitly excludes k3s, real Google SSO, real payment processor, real Apple Music/Spotify, DJ-rig integration, and O7 reject-with-refund.

## 2026-06-24 — Multi-tenant marketplace scope pass

Updated product scope at 2026-06-24T09:17:13-04:00: multi-tenant SaaS reversed from Out/backlog to In/MVP. Reflected D7 marketplace via Stripe Connect in `docs/REQUIREMENTS.md` and `docs/PROJECT-CHARTER.md`; aligned canonical terms Organization, Membership, Event, Area, Platform Admin; added O8–O16 to the PRD open decisions table; recorded scope reversal in `decisions/inbox/saul-multitenancy-scope.md`.

## 2026-06-24 — Phase 2 Backlog Pass

Authored `docs/ROADMAP.md` (release train v0.2.0→v0.6.0+backlog, dependency diagram, epic→release→owner table). Created 11 EPIC GitHub issues (#5–#15) from Rusty's technical sequencing plan. Coordinated four parallel worker agents (saul-core, saul-money, saul-experience, saul-ops) that created 89 story issues — 100 total. Decision BP1 recorded.
