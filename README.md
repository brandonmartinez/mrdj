# mrdj

**A social jukebox for DJs.** Guests request songs into the DJ's live
queue and pay to influence what plays next — a jukebox **+** a live DJ.

🔗 Live (target): https://mrdj.themartinez.cloud

## What it does

- **Guests** (no account needed) join an event, search a catalog backed by **Apple Music**
  and **Spotify**, and request songs into the DJ's queue.
- Guests buy **credits** and spend them to **bump** a song to **Up Next**.
- For the big moment, a guest can buy the single premium **Play Next** slot — only one is
  available at a time, it isn't always available, and it resets after that song plays.
- The **DJ/Admin** runs the show from a real-time console: reorder, approve, remove, and play.

## Status

🚧 **Early setup / MVP foundation.** Requirements and team are in place; implementation is
starting. The biggest open decision is the **payment provider** (see `.squad/decisions.md`, O1).

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React + Tailwind CSS (reusable components) |
| Backend | Node.js |
| Data | PostgreSQL (cluster-shared) |
| Auth | Guest sessions + Google SSO; Admin RBAC |
| Music | Apple Music (MusicKit) + Spotify Web API, normalized `Track` |
| Payments | **Open** — Stripe vs PayPal vs Amazon Pay vs … (credits/wallet model) |
| Hosting | k3s (the project owner's cluster), Traefik + cert-manager, GHCR images |

Engineering principles: **SOLID, DRY, YAGNI**, server-authoritative money paths, no secrets in git.

## Repository layout

```
docs/                     Project charter, requirements (PRD), loop workflow
  PROJECT-CHARTER.md
  REQUIREMENTS.md
  LOOP-ENGINEERING.md
.squad/                   The AI team: roster, routing, decisions, agents
.github/workflows/        Squad automations (heartbeat, triage, issue assign)
.copilot/skills/          Project playbooks (git, reviews, secrets, testing)
```

## The team

Built by **Squad** — a team of specialist AI agents that live in `.squad/`:

| Member | Role |
|--------|------|
| 🏗️ Rusty | Lead / Architect (review gate) |
| ⚛️ Linus | Frontend (React/Tailwind) |
| 🔧 Basher | Backend (Node/Postgres/auth) |
| 💳 Frank | Payments (credits/provider) |
| 🎵 Livingston | Music integration (Apple Music/Spotify) |
| ⚙️ Virgil | DevOps / k3s |
| 🎯 Saul | Product / Requirements |
| 📋 Scribe · 🔄 Ralph · 🛡️ Rai | Memory · work monitor · RAI review |

## How we build: the loop

mrdj is built with a **loop-engineering** workflow (discover → triage → assign → make →
check → record → next), with a strict **maker ≠ checker** split. See
[`docs/LOOP-ENGINEERING.md`](docs/LOOP-ENGINEERING.md).

## Deployment

Runs on k3s, mirroring a proven reference app's deployment pattern already running on the
same cluster: Kustomize bundle (namespace, deployment, service,
ingress, HPA, PDB), `/api/health` probes, Traefik ingress with `letsencrypt-prod` TLS at
`mrdj.themartinez.cloud`, config via configMap + secret generators (no secrets in git).

## Docs

- 📜 [Project Charter](docs/PROJECT-CHARTER.md) — vision, goals, scope, principles
- 📋 [Requirements (PRD)](docs/REQUIREMENTS.md) — personas, features, the Play Next rules
- 🔁 [Loop Engineering](docs/LOOP-ENGINEERING.md) — how the team works
- 🧠 [`.squad/decisions.md`](.squad/decisions.md) — decisions & open questions

## License

See [LICENSE](LICENSE).
