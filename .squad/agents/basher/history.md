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

## 2026-06-23 Wave 2 — Write Endpoints + Money Correctness

**Commit:** `4a70821`

**Foundation verification:** Rusty's Wave 1 foundation booted cleanly (health ✓, /me ✓, queue ✓, search ✓, bundles ✓). No foundation fixes needed.

**Endpoints implemented:**
- `POST /api/events/:slug/requests` — queue (free), boost (1 cr), play_next (3 cr)
- `POST /api/checkout/stub-complete` — resolves stub session, grants correct bundle credits
- `POST /api/admin/credits/grant` — admin grant with actor_id audit trail
- `POST /api/admin/events/:slug/advance` — playing→played, next pending→playing, slot reset

**Money invariants enforced:**
- All paid paths: explicit `BEGIN`/`COMMIT`; `ROLLBACK` on every failure path
- Server-authoritative pricing: `pricing_config` table, never request body
- Idempotency: `credit_transactions.idempotency_key` UNIQUE; even free (0-cost) queue adds insert a row so all tiers have consistent idempotency
- Play Next lock: `SELECT ... FOR UPDATE` on `play_next_slot` BEFORE idempotency check; concurrent second purchaser gets 409
- `StubPaymentProvider` fixed: now stores session metadata (bundleId → totalCredits) in in-memory Map; stub-complete grants correct amount, not a hardcoded 5

**Tests:** 11/11 vitest tests pass (MC-01..MC-10). Run: `npm test -w api`

**Smoke test results:** All MC-01..MC-10 verified via curl against live API (see report to Coordinator).

**Decision:** O3 (realtime transport) remains open — Linus will need polling or SSE to update Cover Flow after queue mutations. Recommend Basher/Linus pair to resolve before sprint review.
