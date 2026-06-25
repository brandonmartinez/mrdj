# api — mrdj Backend

Node.js + TypeScript (Express) API for mrdj.

## Ports

| Service | Port | URL |
|---------|------|-----|
| API     | 3001 | `http://localhost:3001` |
| Web     | 5173 | `http://localhost:5173` |
| Postgres| 5432 | `postgresql://mrdj:mrdj@localhost:5432/mrdj` |

## Quick Start (local, no Docker)

```bash
# 1. Copy and fill in env vars
cp ../.env.example ../.env

# 2. Start Postgres (docker-compose db service only)
docker compose up db -d

# 3. Install and migrate from repo root
cd .. && npm install
npm run db:migrate
npm run db:seed

# 4. Start everything
npm run dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev`         | Start API with `tsx watch` (hot-reload) |
| `npm run build`       | Build to `api/dist/` |
| `npm run db:migrate`  | Run pending migrations |
| `npm run db:seed`     | Run idempotent seed (safe to run multiple times) |
| `npm run db:reset`    | Drop all tables, re-run migrations + seed |

## Environment Variables

See `/.env.example` at repo root.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://mrdj:mrdj@localhost:5432/mrdj` | Postgres connection string |
| `PORT` | `3001` | API listen port |
| `NODE_ENV` | `development` | Environment |
| `SESSION_SECRET` | *(insecure default)* | express-session secret — **change in prod** |
| `REALTIME_TRANSPORT` | `in-process` | Realtime broker: `in-process` or `pg` |
| `REALTIME_DATABASE_URL` | `DATABASE_URL` | Direct Postgres DSN for LISTEN/NOTIFY; local fallback is safe without PgBouncer |

## DB Reset Command

```bash
npm run db:reset -w api
# or from api/ directory:
npm run db:reset
```

This drops all tables, re-runs all migrations, and re-seeds data (idempotent).

## Module Layout

```
api/src/
├── config/     Owner: Rusty   — env config
├── db/         Owner: Rusty   — pool, migrations, seed
├── http/       Owner: Rusty   — Express server, routes, middleware
├── identity/   Owner: Rusty   — GET /api/me, POST /api/dev/act-as
├── event/      Owner: Rusty   — event reads
├── queue/      Owner: Basher  — GET queue (done), POST requests (stub)
├── credits/    Owner: Basher/Frank — wallet reads, CreditsService seam
├── music/      Owner: Livingston — MusicProvider interface + stub
├── payments/   Owner: Frank   — PaymentProvider interface + stub
└── admin/      Owner: Basher  — admin write stubs
```

## PgBouncer Safety

- **No named prepared statements** — never use `{ name: '...' }` in `pool.query()`
- All money paths use explicit `BEGIN` / `COMMIT` transactions
- No session-level `SET` statements
- Play Next uses `SELECT ... FOR UPDATE` (row-level lock) inside a transaction

## Seeded Test Identities

| Identity | ID | Role | Credits |
|----------|----|------|---------|
| Guest User (default) | `00000000-0000-0000-0000-000000000003` | guest | 2 |
| Admin DJ | `00000000-0000-0000-0000-000000000001` | admin | 100 |
| Demo Event | slug `demo` | — | — |

Switch roles in dev: `POST /api/dev/act-as` with body `{ "role": "guest" | "admin" }`

## Key Design Decisions (Slice-01 deviations from ARCHITECTURE.md)

- `wallets.user_id` (not `account_id`) — supports guest wallets without full SSO
- `credit_transactions.user_id` (not `account_id`) — same reason
- **TODO(Basher)**: migrate to `account_id` when real Google SSO ships
