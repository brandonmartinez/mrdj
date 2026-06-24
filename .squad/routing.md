# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Frontend / UI (React, Tailwind, jukebox UX) | Linus | Guest jukebox UI, queue list, credit balance, DJ console, responsive layouts, reusable components |
| Backend / API / queue / auth (Node, Postgres) | Basher | Queue service, Play Next state machine, Google SSO + guest sessions, realtime sync, `/api/health` |
| Payments / credits / wallet | Frank | Provider evaluation, credits purchase, paid bump & Play Next, webhooks, refunds, idempotency |
| Music integration (Apple Music, Spotify) | Livingston | Catalog search, track metadata, provider auth/tokens, normalized Track model |
| DevOps / k3s / deploy | Virgil | Dockerfile, GHCR images, Kustomize manifests, Traefik + cert-manager ingress, HPA/PDB, secrets |
| Product / requirements / backlog | Saul | PRD upkeep, backlog → GitHub issues, loop cadence, acceptance criteria, scope control |
| Architecture & scope decisions | Rusty | System design, domain model, contracts, tradeoffs, ADRs in `decisions.md` |
| Code review (reviewer gate) | Rusty | Review PRs, enforce SOLID/DRY/YAGNI; on reject a *different* agent revises |
| Testing | Implementer + Rusty (gate) | Feature owner writes unit/integration tests; Rusty verifies coverage (see `.copilot/skills/test-discipline`) |
| Session logging | Scribe | Automatic — never needs routing |
| RAI review | Rai | Content safety, bias checks, credential detection, ethical review |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
