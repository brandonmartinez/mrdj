# mrdj — k8s Deployment

> Kustomize-based k3s deployment manifests for mrdj, mirroring a proven reference app's deployment pattern on the same k3s cluster.

## Overview

This directory contains a complete Kubernetes deployment bundle for mrdj, designed to deploy to the project owner's k3s cluster at `mrdj.themartinez.cloud`.

**Key characteristics:**
- **Namespace:** `mrdj`
- **Image:** `ghcr.io/brandonmartinez/mrdj` (published via CI)
- **Replicas:** 2 (HPA scales 2–3 based on CPU ~60%)
- **Health:** `/api/health` startup/readiness/liveness probes
- **Ingress:** Traefik + cert-manager TLS (`letsencrypt-prod`)
- **Config:** Kustomize configMap + secret generators from `.env` files
- **Database:** Shared cluster PostgreSQL (PgBouncer endpoint in `data` namespace)

## Architecture

```
┌─────────────────────────────────────────┐
│ mrdj.themartinez.cloud (HTTPS)         │
│ ↓ Traefik Ingress (TLS cert-manager)   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ mrdj-svc (ClusterIP)                    │
│ ↓ Load balances to 2+ pods (HPA 2-3)   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ mrdj pods (topology spread across nodes)│
│ - /api/health probes                    │
│ - envFrom configMap + secret            │
│ - Resource limits: 512Mi / 1 CPU        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ postgres-svc.data.svc.cluster.local     │
│ (shared PostgreSQL via PgBouncer)       │
│ Database: mrdj                          │
└─────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `namespace.yml` | Creates the `mrdj` namespace |
| `deployment.yml` | Main app deployment (2 replicas, health probes, topology spread) |
| `service.yml` | ClusterIP service exposing port 80 → container 3000 |
| `ingress.yml` | Traefik ingress with TLS (cert-manager `letsencrypt-prod`) |
| `horizontalpodautoscaler.yml` | HPA scaling 2–3 replicas at 60% CPU |
| `pdb.yml` | PodDisruptionBudget ensuring min 1 replica available during disruptions |
| `kustomization.yml` | Kustomize orchestration (configMap + secret generators, labels) |
| `.env.example` | Non-secret config placeholder (committed) |
| `.env.secret.example` | Secret placeholders (committed, for documentation) |

**Not committed (gitignored):**
- `.env` — real non-secret config
- `.env.secret.temp` — real secrets (referenced by `kustomization.yml`)

## Build → Push → Deploy Flow

### 1. Build & Push Image (CI)

```bash
# Build the container image
docker build -t ghcr.io/brandonmartinez/mrdj:latest .

# Push to GitHub Container Registry
docker push ghcr.io/brandonmartinez/mrdj:latest
```

CI will tag images with both `:latest` and commit SHA (e.g., `:sha-abc123`). The Kustomize manifest uses `:latest` as a placeholder; CI can override the image tag before applying.

### 2. Configure Environment

Copy the example files and fill in real values:

```bash
cd k8s
cp .env.example .env
cp .env.secret.example .env.secret.temp

# Edit .env and .env.secret.temp with real values
# NEVER commit .env.secret.temp — it's gitignored
```

**Key values to set:**

| Variable | Where | Notes |
|----------|-------|-------|
| `POSTGRES_USER` | `.env.secret.temp` | From cluster `data` namespace (default: `rpi`) |
| `POSTGRES_PASSWORD` | `.env.secret.temp` | From cluster `data` secret |
| `GOOGLE_CLIENT_ID` | `.env.secret.temp` | Google SSO credentials |
| `GOOGLE_CLIENT_SECRET` | `.env.secret.temp` | Google SSO credentials |
| `JWT_SECRET` | `.env.secret.temp` | Generate a secure random string |

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

The `mrdj` database must be created in the shared cluster PostgreSQL. Add an init script to the `data` namespace's `postgres-init` ConfigMap:

```yaml
# In the cluster's shared-database init ConfigMap (data namespace: postgres-init.yml)
data:
  init-mrdj-db.sh: |
    #!/bin/bash
    set -e

    # Create mrdj database if it doesn't exist
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
      CREATE DATABASE mrdj;
    EOSQL

    echo "mrdj database initialization complete"
```

After updating the `data` resource, restart the PostgreSQL pod to run the init script.

## Mirrored Patterns (from the reference app)

This deployment closely follows the structure of an existing reference app on the same cluster:

- **Health probes:** Same `/api/health` endpoint, same timing thresholds
- **Resource limits:** Adjusted for mrdj's expected load (128Mi–512Mi, 100m–1000m CPU)
- **Ingress annotations:** Identical cert-manager + Traefik HTTPS-redirect middleware
- **HPA strategy:** 2–3 replicas, 60% CPU target (same as the reference app)
- **PDB:** minAvailable 1 (ensures availability during node maintenance)
- **Topology spread:** Distributes pods across nodes for resilience
- **Config pattern:** Kustomize generators from `.env` files, secrets never in git

## mrdj-specific choices

| Aspect | mrdj |
|--------|------|
| Container port | 3000 |
| Database | `mrdj` |
| Hostname | `mrdj.${NETWORK_HOSTNAME_SUFFIX}` |
| Resource limits | 512Mi / 1000m CPU (higher for realtime + payments) |

## Assumptions

1. **`${NETWORK_HOSTNAME_SUFFIX}` = `themartinez.cloud`**  
   Confirmed from cluster `.env`: `NETWORK_HOSTNAME_SUFFIX=themartinez.cloud`  
   → mrdj will be accessible at `https://mrdj.themartinez.cloud`

2. **Shared PostgreSQL (data namespace)**  
   mrdj connects to the cluster's existing PostgreSQL via PgBouncer:
   - **Service DNS:** `postgres-svc.data.svc.cluster.local:5432`
   - **Auth:** Same `POSTGRES_USER` / `POSTGRES_PASSWORD` as other apps
   - **Database:** `mrdj` (created via init script in `postgres-init` ConfigMap)
   - **Connection mode:** PgBouncer transaction pooling (efficient for Node.js)

## Next Steps

1. **Implement `/api/health` endpoint** (Basher) — must return 200 OK when app is ready
2. **Database init script** — add `init-mrdj-db.sh` to `data/postgres-init.yml` in cluster repo
3. **CI/CD pipeline** — build → push → deploy automation (Virgil)
4. **Secrets provisioning** — generate real `.env.secret.temp` values and apply (Virgil + team)
5. **Resolve Open Decisions:**
   - **O1:** Payment provider config (Frank)
   - **O5:** Confirm manifest location (this repo vs cluster repo) — see decision inbox
   - **O3:** WebSocket/SSE config (Basher)
   - **O6:** Music provider scope (Livingston + Saul)

## Troubleshooting

**Pod not starting:**
```bash
kubectl describe pod -n mrdj -l app=mrdj
kubectl logs -n mrdj -l app=mrdj --tail=100
```

**Health check failing:**
- Verify `/api/health` endpoint exists and returns 200 OK
- Check startup probe `failureThreshold` (12 × 10s = 2min max startup time)

**Database connection errors:**
- Verify `postgres-svc.data.svc.cluster.local` is reachable from mrdj namespace
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
- **Requirements:** `docs/REQUIREMENTS.md` §9 Deployment & Infrastructure
