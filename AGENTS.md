# Agent Operating Instructions

This repository is run by **Squad** — an AI team of specialists that live in `.squad/`.
The Squad Coordinator and roster are defined in `.github/agents/squad.agent.md` and
`.squad/team.md`. Routing rules live in `.squad/routing.md`.

## Default behavior: route work through Squad

For **any real work**, do not act as a generic assistant — operate through the Squad
coordinator. Concretely:

- **Delegate to the Squad agent.** Invoke the `Squad` custom agent (via the Task tool,
  `agent_type: "Squad"`) and let it orchestrate: cast/assign the right specialist,
  enforce handoffs, and gate on reviewer approval. Pass the user's full request as
  context.
- **Follow Squad's model** when you coordinate directly: delegate to the team member
  who owns the domain (see `.squad/routing.md`), never produce domain artifacts as the
  coordinator, and respect the reviewer gate (Rusty) before work is considered done.
- **Maximize parallelism.** When multiple specialists could usefully start, spawn them
  in parallel (background) rather than serially.

"Real work" = anything that creates, changes, reviews, designs, tests, deploys, or
plans code/artifacts in this repo (features, bug fixes, refactors, infra, PRs, issue
triage, architecture/scope decisions, requirements).

## Answer directly (do NOT route to Squad)

To keep things fast, handle these yourself without spawning Squad:

- Trivial, read-only questions answerable from context (e.g. "what port does the API
  run on?", "where is the queue service?", "show me the team roster").
- Status checks, factual lookups, and quick file reads.
- Clarifying questions back to the user.

When in doubt between a quick answer and real work, prefer routing to Squad.

## Routing reference

| Work type | Owner |
|-----------|-------|
| Frontend / UI (React, Tailwind, jukebox UX) | Linus |
| Backend / API / queue / auth (Node, Postgres) | Basher |
| Payments / credits / wallet | Frank |
| Music integration (Apple Music, Spotify) | Livingston |
| DevOps / k3s / deploy | Virgil |
| Product / requirements / backlog | Saul |
| Architecture, scope, code review (gate) | Rusty |
| Demo / release reels (post-review feature videos) | Roman |
| Session logging | Scribe (automatic, background) |
| RAI / content safety review | Rai |

See `.squad/routing.md` for the full table and rules, and
`.copilot/skills/` for Squad conventions, git workflow, and review protocol.
