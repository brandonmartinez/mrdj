# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: The Play Next slot is a single global lock per active event: one purchasable at a time, gated availability, resets after the bumped track finishes. Model it as an explicit state machine, not ad-hoc flags.
- 2026-06-23: Credits ledger is mine; Frank's provider tops up credit balances via verified webhooks. Spends must be transactional + idempotent. Shared cluster PostgreSQL (`data` resource) is the likely DB — confirm with Virgil.
- 2026-06-23: Expose `/api/health` for k8s probes (the reference app uses it on container port 3001).

## 2026-06-23 Loop Round 1 — O3 Handoff + A1 Integration

**Loop workstream:** Architecture baseline (A1) + Realtime transport (O3) framing + CreditsService contract seam definition.

**O3 — Realtime transport (YOUR DECISION):** A1 leans SSE for simplicity (mostly server→client fan-out shape), but **you own the final call** based on bidirectionality needs and ops comfort. Criteria: chat-like bidirectional interaction? → WebSocket. Mostly server-push (queue updates to guests)? → SSE. Ops burden? Node.js + SSE straightforward; WebSocket more overhead. Decision pending; document in decisions.md once finalized.

**A1 — Architecture baseline confirmed:** Play Next single-slot lock + reset state machine (available → locked → cooldown → available). You implement: row-level lock + atomic reset transition after bumped song plays. Queue reorder logic for Up Next (always available, free or low-cost). Concurrency protection in place.

**CreditsService contract seam (YOUR SPEND-SIDE):** Interface you depend on: `grantCredits(accountId, amount, source, idempotencyKey)`, `spendCredits(accountId, amount, source, idempotencyKey)`, `refundCredits(accountId, amount, reason, sourceId, idempotencyKey)`, `getBalance(accountId)`. Frank (payments webhook) calls grant/refund; you call spend when a queue action costs credits. Idempotent, append-only ledger. Contract lives in CreditsService module.

**Follow-ups:**
- **Confirm DB driver + PgBouncer compatibility:** Which Node.js ORM/driver (Prisma, TypeORM, Sequelize, pg)? Does it support PgBouncer's transaction pooling mode? (Most do, but confirm). Needed for A2 (shared Postgres `mrdj` via postgres-svc.data.svc.cluster.local:5432).
- **Implement queue state machine:** Row-level lock on PlayNextSlot, atomic reset. Test concurrency under load.
- **O7 (refund policy) touches your code:** When DJ skips a paid Play Next song, call `refundCredits(accountId, play_next_cost, "dj_skip", queue_item_id, idempotencyKey)`. Frank handles policy, you implement the trigger in admin module.

**Status:** A1 baseline locked. O3 framed, awaiting your decision. No blockers. Ready to start queue/state machine implementation post-O3 confirmation.
