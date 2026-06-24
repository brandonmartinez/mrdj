# Rusty — Agent History

## 2026-06-23 | Wave 1 — Foundation (Slice-01)

**Status:** ✅ Complete

### What was built
Standing up a greenfield monorepo from scratch for the mrdj guest jukebox:

- **Root `package.json`** — npm workspaces (`api/`, `web/`), scripts: `dev`, `build`, `test`, `db:migrate`, `db:seed`, `db:reset`
- **`docker-compose.yml`** — `db` (postgres:16-alpine) + `app` (node:22-alpine) services, named volumes, healthcheck
- **`.devcontainer/`** — Node 22 Alpine Dockerfile + devcontainer.json (ports 3001, 5173, 5432)
- **`api/`** — Express + TypeScript API:
  - Full DB schema (11 tables) via node-pg-migrate
  - Idempotent seed (15 CC tracks, 11 queue items, 2 users, wallets, pricing, 3 bundles)
  - All READ endpoints implemented for real (health, me, queue, search, bundles)
  - All WRITE/money paths left as typed 501 stubs with `// TODO(Basher)` / `// TODO(Frank)`
  - `MusicProvider` + `PaymentProvider` interfaces with Stub implementations
  - `CreditsService` seam implemented (grantCredits real; spend/refund stubs)
  - PgBouncer-safe throughout (no named prepared statements, explicit transactions)
- **`web/`** — Vite + React + TypeScript + Tailwind v3 placeholder UI; polls `/api/me` + `/api/events/demo/queue`, dev role switcher, proves Vite proxy to backend
- **`docs/slice-01-contract.md`** — Frozen API contract with all types, endpoints, ownership table

### Ports
- API: `http://localhost:3001`
- Web: `http://localhost:5173`
- Postgres: `localhost:5432`

### Acceptance verification (all ✅)
1. `npm install` — 317 packages, workspaces resolve
2. `docker compose up db` — Postgres healthy
3. `npm run db:migrate` — 11 tables created, idempotent
4. `npm run db:seed` — data seeded, idempotent
5. `npm run db:reset` — drops + remigrates + reseeds, idempotent
6. `npm run dev` — API on 3001, web on 5173
7. `/api/health` → `{"status":"ok","db":"ok"}`
8. `/api/me` → guest with 2 credits
9. `/api/events/demo/queue` → populated QueueView (4 played, 1 playing, 6 pending)
10. `/api/tracks/search?q=beethoven` → 4 results
11. Web proxy → `/api/health` via port 5173 returns ok
12. `docs/slice-01-contract.md` exists and matches implementation

### Deviations from task spec
- `wallets.user_id` instead of `account_id` — supports guest wallets without SSO; Basher should migrate to `account_id` when Google SSO ships
- Event name `"The Ocean's Eleven After Party"` (fun, per instructions)
- express-session in-memory store (dev only; no Redis needed for Wave 1)

### Notable issues resolved
- `node-pg-migrate` binary hoisted by npm workspaces to root `node_modules/.bin/`; `api/src/db/migrate.ts` searches both locations
- Docker `version: '3.9'` removed (was obsolete in Compose v2)

### Files owned (Rusty)
- All scaffold/infra files
- `api/src/identity/` — me handler, act-as handler
- `api/src/event/` — event lookup
- `api/src/queue/index.ts` — read path only (getQueueHandler)
- `api/src/music/` — provider interface + stub
- `api/src/payments/provider.ts` — provider interface
- `api/src/http/` — server, routes, middleware
- `api/src/config/`
- `api/src/db/` — pool, migrate, seed
- `web/src/` — entire placeholder UI

### Handoff notes
- **Basher:** implement POST /events/:slug/requests, /checkout/stub-complete, /admin/credits/grant, /admin/events/:slug/advance. All stubs are in `api/src/queue/index.ts`, `api/src/payments/index.ts`, `api/src/admin/index.ts`. See `docs/slice-01-contract.md`.
- **Linus:** Replace `web/src/App.tsx` with real Cover Flow UI (search-as-you-type, modals). API client is `web/src/api.ts`. See `docs/slice-01-contract.md`.
- **Frank:** Finalize `PaymentProvider` interface in `api/src/payments/provider.ts`; implement real checkout provider; see `CreditsService.grantCredits()` for integration point.
