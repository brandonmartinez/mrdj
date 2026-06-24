# mrdj — Loop-Engineering Workflow

> How we build mrdj. Based on Addy Osmani's
> [Loop Engineering](https://addyosmani.com/blog/loop-engineering/): you stop hand-prompting
> a single agent and instead design a **loop** — a system that finds work, hands it out, checks
> it, records what's done, and decides the next thing. Squad already provides every primitive
> the loop needs.

## The loop, mapped onto Squad

Loop engineering needs five pieces plus a memory. Here's how each maps to this repo:

| Loop primitive | Job in the loop | mrdj / Squad implementation |
|----------------|-----------------|------------------------------|
| **Automations** | Discovery + triage on a schedule | **Ralph** (work monitor / heartbeat) + GitHub workflows in `.github/workflows/` (`squad-heartbeat`, `squad-triage`, `squad-issue-assign`, `sync-squad-labels`) |
| **Worktrees** | Isolate parallel work | Squad worktree-aware spawning — issue work gets its own branch/worktree so agents don't collide |
| **Skills** | Codify project knowledge | `.copilot/skills/` (git-workflow, reviewer-protocol, test-discipline, secret-handling, …) and team-earned `.squad/skills/` |
| **Plugins / connectors** | Connect real tools | **MCP** via `.mcp.json` (the `squad_state` server) and the GitHub MCP / `gh` CLI |
| **Sub-agents** | Maker ideates, a *different* one checks | Squad specialists (makers) + **Rusty** (reviewer gate) + **Rai** (RAI/safety). Reviewer Rejection Protocol enforces maker ≠ checker |
| **Memory** | Track what's done / what's next | `.squad/decisions.md` (direction), per-agent `history.md` (learnings), `.squad/orchestration-log/` + `.squad/log/` (evidence), and **GitHub issues** (the backlog) |

## The iteration cycle

Each loop iteration runs:

1. **Discover** — Saul (with the team) surfaces the next shippable slice from `docs/REQUIREMENTS.md` and the backlog. Ralph and the GitHub triage workflow keep the inbox fresh.
2. **Triage & decompose** — Saul decomposes into independently-shippable work items; Rusty sanity-checks the technical shape. Items become **GitHub issues** labeled `squad` → `squad:{member}`.
3. **Assign** — the Coordinator routes each issue to its owner (see `.squad/routing.md`). Independent items run **in parallel** in their own worktrees.
4. **Make** — the owning specialist implements against agreed contracts, writes tests, opens a PR.
5. **Check (maker ≠ checker)** — **Rusty** reviews and gates (can reject → a *different* agent revises). **Rai** runs the RAI/safety pass. This is the heart of the loop: the one who wrote it is not the one who grades it.
6. **Record** — decisions land in `.squad/decisions.md`; the Scribe writes the session/orchestration logs; histories capture learnings. *The agent forgets between runs; the repo doesn't.*
7. **Decide next** — close the issue, update `docs/REQUIREMENTS.md` / backlog if scope shifted, and pick the next slice. Repeat.

## Stopping conditions (per item)

An item is "done" when its acceptance criteria are met, tests pass, Rusty has approved, and Rai is green. Money-path items (credits, Up Next, Play Next settlement) additionally require: transactional, idempotent, no double-charge/grant, verified by webhook.

## Cadence & ceremonies

Configured in `.squad/ceremonies.md`:

- **Design Review** (auto, *before* multi-agent work touching shared systems) — agree interfaces/contracts first. Critical for the queue ⇄ credits ⇄ payments seams.
- **Retrospective** (auto, *after* a build/test failure or a reviewer rejection) — root-cause and adjust.
- **Weekly Retrospective with enforcement** — what shipped / didn't; action items become `retro-action` GitHub issues (markdown checklists don't get done; issues do).

## How to run the loop (for the project owner)

- Kick a slice: *"Team, let's build the credits purchase flow"* → the Coordinator fans out to the right specialists in parallel.
- Keep it moving autonomously: *"Ralph, go"* → Ralph works the queue/backlog until it's clear, then idle-watches.
- Pull from issues: *"work on issue #N"* or *"show the backlog"*.
- Record direction: any "always/never/from now on" is captured to the decision ledger automatically.

## Guardrails

- **Token awareness** — the loop is powerful but spends tokens; keep iterations scoped to a shippable slice (YAGNI).
- **Maker ≠ checker** — never let the author approve their own money-path or security change.
- **Secrets** — never in git; see `.copilot/skills/secret-handling`.
