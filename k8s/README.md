# mrdj — k8s Deployment

> Kustomize-based k3s deployment manifests for mrdj, mirroring a proven reference app's deployment pattern on the same k3s cluster.

## Overview

This directory contains a complete Kubernetes deployment bundle for mrdj, designed to deploy to the project owner's k3s cluster at `mrdj.themartinez.cloud`.

**Key characteristics:**
- **Namespace:** `mrdj`
- **Image:** `ghcr.io/brandonmartinez/mrdj` (published via CI)
- **Replicas:** 2 baseline, autoscaled to 3 by CPU HPA
- **Health:** `/api/livez` startup/liveness probes; `/api/health` readiness probe
- **Ingress:** Traefik + cert-manager TLS (`letsencrypt-prod`)
- **Config:** Kustomize configMap + secret generators from `.env` files
- **Database:** Shared cluster PostgreSQL (`DATABASE_URL` via PgBouncer; realtime uses a direct Postgres DSN)

## Architecture

```
┌─────────────────────────────────────────┐
│ mrdj.themartinez.cloud (HTTPS)         │
│ ↓ Traefik Ingress (TLS cert-manager)   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ mrdj-svc (ClusterIP)                    │
│ ↓ Routes to 2–3 pods (HPA enabled)      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ mrdj pods (multi-replica beta topology) │
│ - /api/livez startup/liveness probes    │
│ - /api/health readiness probe           │
│ - REALTIME_TRANSPORT=pg fan-out         │
│ - envFrom configMap + secret            │
│ - Resource limits: 512Mi / 1 CPU        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ DATABASE_URL: postgres-svc...           │
│ (shared PostgreSQL via PgBouncer)       │
│ REALTIME_DATABASE_URL: postgres-primary │
│ (DIRECT Postgres; never PgBouncer)      │
│ Database: mrdj                          │
└─────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `namespace.yml` | Creates the `mrdj` namespace |
| `deployment.yml` | Main app deployment (2 replicas, health probes, topology spread) |
| `horizontalpodautoscaler.yml` | HPA scaling mrdj from 2 to 3 replicas on CPU |
| `service.yml` | ClusterIP service exposing port 80 → container 3000 |
| `ingress.yml` | Traefik ingress with TLS (cert-manager `letsencrypt-prod`) |
| `pdb.yml` | PodDisruptionBudget ensuring min 1 replica available during disruptions |
| `kustomization.yml` | Kustomize orchestration (configMap + secret generators, labels) |
| `init-mrdj-db.sh` | Idempotent Postgres bootstrap (creates the `mrdj` role + database); promoted into the cluster's `postgres-init` ConfigMap (#45) |
| `.env.example` | Non-secret config placeholder, configMap source (committed) |
| `.env.secret.example` | Secret placeholders, secret source (committed, for documentation) |

**Not committed (gitignored):**
- `.env` — real non-secret config
- `.env.secret.temp` — real secrets (referenced by `kustomization.yml`)

## Build → Push → Deploy Flow

### 1. Build & Push Image (CI)

`.github/workflows/build-publish.yml` publishes the image on pushes to `main` that touch application inputs (docs and `k8s/`-only changes are ignored). The publish job's current gate (added in `a07f4b7`) is:

1. `npm ci`
2. `npm run db:migrate -w api` against a throwaway Postgres service
3. `npm run db:seed -w api` with `SEED_ITUNES=false`
4. `npm run test -w api`
5. `npm run build`

After those gates pass, CI publishes `:latest`, `:v<package-version>`, and `:sha-<short-commit>` tags to `ghcr.io/brandonmartinez/mrdj`. The current authored manifest still uses `:latest` as a placeholder; immutable digest/SHA promotion through the cluster repo is deferred to post-beta hardening (#108).

### 2. Configure Environment

Copy the example files and fill in real values:

```bash
cd k8s
cp .env.example .env
cp .env.secret.example .env.secret.temp

# Edit .env and .env.secret.temp with real values
# NEVER commit .env.secret.temp — it's gitignored
```

This is the current local secret-generation path: real secret values are written into the gitignored `k8s/.env.secret.temp`, then Kustomize's `secretGenerator` renders them into a Kubernetes Secret at apply time. Do not commit or paste the generated file into either repo. External/sealed secrets are a post-beta hardening item (#108).

**Key values to set:**

| Variable | Where | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `.env.secret.temp` | Full DSN incl. cluster Postgres user + password (kustomize does not interpolate) |
| `REALTIME_TRANSPORT` | `.env` | `pg` in production so LISTEN/NOTIFY fans out across replicas |
| `REALTIME_DATABASE_URL` | `.env.secret.temp` | **DIRECT Postgres DSN only. Do not point at PgBouncer; LISTEN requires a stable session connection.** |
| `SESSION_SECRET` | `.env.secret.temp` | 64-char random string for express-session cookie signing |
| `GOOGLE_CLIENT_ID` | `.env.secret.temp` | Google SSO credentials |
| `GOOGLE_CLIENT_SECRET` | `.env.secret.temp` | Google SSO credentials |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | `.env.secret.temp` | Stripe Connect (live for prod, test for staging) |

Non-secret config (`NODE_ENV`, `PORT`, `REALTIME_TRANSPORT`, `WEB_BASE_URL`, `GOOGLE_REDIRECT_URI`, `MUSIC_PROVIDER`,
`PLATFORM_FEE_PERCENT`, `PAYMENTS_CURRENCY`, Stripe Connect redirect URLs, `REFUND_WINDOW_MS`,
`RATE_LIMIT_*`) lives in `.env`. All keys mirror exactly what `api/src/config/index.ts` reads.

### 3. Deploy to k3s

**Dry-run (verify manifests):**
```bash
kubectl kustomize k8s
```

**Apply:**
```bash
kubectl apply -k k8s
```

**Verify:**
```bash
kubectl get all -n mrdj
kubectl get ingress -n mrdj
kubectl describe deployment mrdj -n mrdj
kubectl logs -n mrdj -l app=mrdj --tail=50
```

### 4. Database Setup

The `mrdj` database must be created in the shared cluster PostgreSQL. The idempotent
**`init-mrdj-db.sh`** (in this directory) creates the `mrdj` role and database if they don't
exist; promote it into the `data` namespace's `postgres-init` ConfigMap:

```yaml
# In the cluster's shared-database init ConfigMap (data namespace: postgres-init.yml)
data:
  init-mrdj-db.sh: |   # contents of k8s/init-mrdj-db.sh
    ...
```

It reads `POSTGRES_USER` / `POSTGRES_DB` from the Postgres init context and `MRDJ_DB_PASSWORD`
(inject via secret). Safe to re-run: it guards both the role (CREATE/ALTER) and database creation.
After updating the `data` resource, restart the PostgreSQL pod to run the init script.

## Mirrored Patterns (from the reference app)

This deployment closely follows the structure of an existing reference app on the same cluster:

- **Health probes:** Startup/liveness use `/api/livez`; readiness uses DB-gated `/api/health`
- **Resource limits:** Adjusted for mrdj's expected load (128Mi–512Mi, 100m–1000m CPU)
- **Ingress annotations:** Identical cert-manager + Traefik HTTPS-redirect middleware
- **HPA strategy:** min 2, max 3 replicas; CPU target matches the pre-stopgap HPA
- **PDB:** minAvailable 1 (ensures availability during node maintenance)
- **Topology spread:** Distributes pods across nodes for resilience
- **Config pattern:** Kustomize generators from `.env` files, secrets never in git

## Multi-replica realtime topology

Production now runs the v0.6.0 multi-replica topology: sessions are shared through the
Postgres-backed `connect-pg-simple` store, and realtime fan-out uses the Epic 8
Postgres LISTEN/NOTIFY broker (`REALTIME_TRANSPORT=pg`). The deployment starts at 2
replicas, the HPA can scale to 3, and the PDB keeps at least 1 pod available during
voluntary disruptions.

> **Operational footgun:** `REALTIME_DATABASE_URL` must be a **direct Postgres** DSN.
> Do **not** point it at PgBouncer or any transaction-pooled endpoint. LISTEN/NOTIFY
> keeps a long-lived session connection; PgBouncer transaction pooling will break that
> registration. In this cluster, `DATABASE_URL` uses `postgres-svc.data.svc.cluster.local`
> (PgBouncer) and `REALTIME_DATABASE_URL` uses
> `postgres-primary.data.svc.cluster.local:5432/mrdj` (direct Postgres).

## Known limitations / Post-beta hardening (#108)

These are intentionally documented gaps for the beta; do not silently treat them as done:

- **Immutable image promotion:** replace the mutable `:latest` deployment placeholder with an immutable SHA tag or image digest promoted through the cluster repo. Also digest-pin moving base images (`node:22-alpine`, `postgres:16-alpine`) and automate updates.
- **Secret management:** replace local plaintext `.env.secret.temp` production secret generation with External Secrets, SOPS/age, SealedSecrets, or the cluster-standard secret manager.
- **HSTS/security headers:** Traefik TLS redirect is configured, but this manifest does not attach an explicit HSTS headers middleware yet. Add it once hostname/TLS behavior is confirmed.
- **Standalone image healthcheck:** Kubernetes probes cover cluster operation, but the Docker image does not define a `HEALTHCHECK` for non-k8s consumers. If needed, add one against `/api/livez`.

## mrdj-specific choices

| Aspect | mrdj |
|--------|------|
| Container port | 3000 |
| Database | `mrdj` |
| Hostname | `mrdj.${NETWORK_HOSTNAME_SUFFIX}` |
| Resource limits | 512Mi / 1000m CPU (higher for realtime + payments) |

## Assumptions

1. **Multi-replica beta topology**
   HPA is part of `kustomization.yml`; keep the baseline at `replicas: 2`, `minReplicas: 2`,
   and `maxReplicas: 3` unless capacity testing justifies a larger beta footprint.

2. **`${NETWORK_HOSTNAME_SUFFIX}` = `themartinez.cloud`**
   Confirmed from cluster `.env`: `NETWORK_HOSTNAME_SUFFIX=themartinez.cloud`
   → mrdj will be accessible at `https://mrdj.themartinez.cloud`

3. **Shared PostgreSQL (data namespace)**
   mrdj connects to the cluster's existing PostgreSQL:
   - **App DB service DNS:** `postgres-svc.data.svc.cluster.local:5432` (PgBouncer transaction pooling)
   - **Realtime DB service DNS:** `postgres-primary.data.svc.cluster.local:5432` (direct Postgres; required for LISTEN/NOTIFY)
   - **Auth:** Same `POSTGRES_USER` / `POSTGRES_PASSWORD` as other apps
   - **Database:** `mrdj` (created via init script in `postgres-init` ConfigMap)
   - **Connection mode:** PgBouncer transaction pooling for normal app queries; direct Postgres for realtime LISTEN/NOTIFY only

## Next Steps

1. **Database init script** — add `init-mrdj-db.sh` to `data/postgres-init.yml` in cluster repo
2. **Promote manifests at launch** — copy the validated `k8s/` bundle into the cluster GitOps repo
3. **Secrets provisioning** — generate real `.env.secret.temp` values locally for beta apply; replace with sealed/external secrets post-beta (#108)
4. **Resolve Open Decisions:**
   - **O1:** Payment provider config (Frank)
   - **O5:** Manifest location — RESOLVED, see `docs/decisions/manifests-location.md` (cluster repo canonical; author/validate in `k8s/`, promote at launch)
   - **O3:** WebSocket/SSE config (Basher)
   - **O6:** Music provider scope (Livingston + Saul)

## Troubleshooting

**Pod not starting:**
```bash
kubectl describe pod -n mrdj -l app=mrdj
kubectl logs -n mrdj -l app=mrdj --tail=100
```

**Health check failing:**
- Verify `/api/livez` returns 200 OK for startup/liveness.
- Verify `/api/health` returns 200 OK only when the app is ready, including database connectivity.
- Check startup probe `failureThreshold` (12 × 10s = 2min max startup time)

**Database connection errors:**
- Verify `postgres-svc.data.svc.cluster.local` is reachable from mrdj namespace
- Verify `REALTIME_DATABASE_URL` points to `postgres-primary.data.svc.cluster.local:5432`, not PgBouncer
- Check `POSTGRES_USER` / `POSTGRES_PASSWORD` match cluster `data` secret
- Confirm `mrdj` database exists (run init script)

**TLS certificate not issuing:**
- Check cert-manager logs: `kubectl logs -n cert-manager -l app=cert-manager`
- Verify DNS `mrdj.themartinez.cloud` points to cluster ingress IP
- Check `letsencrypt-prod` ClusterIssuer status

## References

- **Pattern source:** an existing reference app's manifests in the cluster infrastructure repo
- **Shared DB:** the cluster's shared-database (`data` namespace) manifests
- **Decision log:** `.squad/decisions.md` (D2 deployment, O5 manifest location)
- **Manifests location (O5):** `docs/decisions/manifests-location.md` — cluster repo is canonical for what's deployed; `k8s/` is the authoring + validation copy during MVP, promoted at go-live.
- **Requirements:** `docs/REQUIREMENTS.md` §9 Deployment & Infrastructure
