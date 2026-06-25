# Virgil DevOps / Platform Review — 2026-06-24

## Overall health

Platform/deploy is close to MVP-ready: the production Dockerfile is multi-stage, prunes dev dependencies, runs as the `node` user, k8s manifests validate with `kubectl kustomize k8s`, probes now correctly split process liveness (`/api/livez`) from DB-gated readiness (`/api/health`), resources/PDB/TLS ingress are present, and `build-publish.yml` gates image publication behind migrations, seed, API tests, and build with `SEED_ITUNES=false`. The main blockers are operational hardening: multi-replica/HPA is unsafe while sessions remain in-memory, release/automation workflows have stale no-op test commands, and deployment still relies on mutable image tags plus local plaintext secret generation.

## Findings

| Sev | Title | Location | Problem | Fix |
| --- | --- | --- | --- | --- |
| High | HPA/multi-replica is unsafe with in-memory Express sessions (#105 blocker) | `api/src/http/server.ts:46`, `k8s/deployment.yml:6`, `k8s/horizontalpodautoscaler.yml:10` | `express-session` is configured without a shared store, so the default in-memory store is per pod. The deployment starts at 2 replicas and HPA scales 2–3, which can break login/OAuth state and user sessions when traffic lands on a different pod. | Add a shared session store (Postgres/Redis) before allowing multiple replicas, or temporarily force `replicas: 1`, remove/disable HPA, and accept single-pod availability until #105 is resolved. |
| High | Squad release/preview/CI workflows run a stale no-op test command | `.github/workflows/squad-ci.yml:23`, `.github/workflows/squad-preview.yml:29`, `.github/workflows/squad-release.yml:22`, `.github/workflows/squad-insider-release.yml:22` | These workflows use `node --test test/*.test.cjs`, but there are no `test/*.test.cjs` files in this repo; verified the command exits 0. Release/promote paths can therefore pass without running API/Vitest coverage or the workspace build. | Replace with the repo-native gate (`npm ci`, DB service where needed, `npm run test -w api`, `npm run build`) or reuse the `build-publish.yml` test job pattern. |
| Medium | Deployment uses mutable `latest` image tag | `k8s/deployment.yml:22`, `.github/workflows/build-publish.yml:93` | CI publishes `latest`, `v<version>`, and `sha-<short>`, but the deployment manifest consumes `:latest`, making rollbacks/audits non-reproducible and allowing accidental drift. | Promote immutable SHA tags or digests into the GitOps/kustomize overlay; reserve `latest` for local/manual smoke testing only. |
| Medium | Runtime secrets are generated from a local plaintext file | `k8s/kustomization.yml:16` | `secretGenerator` reads `k8s/.env.secret.temp`. It is gitignored and not committed, which is good, but production deploys depend on a local plaintext file that is not auditable or rotation-friendly. | Move production secrets to External Secrets, SOPS/age, SealedSecrets, or the cluster’s canonical secret management flow; keep `.env.secret.temp` for local dry-runs only. |
| Medium | Base images are tag-pinned but not digest-pinned | `Dockerfile:13`, `Dockerfile:30`, `docker-compose.yml:3`, `.github/workflows/build-publish.yml:29` | `node:22-alpine` and `postgres:16-alpine` are moving tags. Builds are lockfile-reproducible at the npm layer but not fully reproducible at the OS/base-image layer. | Pin image digests and automate digest updates with Renovate/Dependabot, or document the accepted mutable-base policy. |
| Low | Production image lacks a container-level healthcheck | `Dockerfile:46` | Kubernetes probes cover cluster operation, but standalone Docker/GHCR consumers get no image health signal. | Add a lightweight `HEALTHCHECK` against `/api/livez` (or document that health is k8s-only). |
| Low | Ingress has TLS redirect but no explicit HSTS header policy | `k8s/ingress.yml:7` | Traefik redirect middleware is referenced and TLS is configured, but no HSTS/security-headers middleware is attached in this manifest. | Add/attach a Traefik headers middleware with `Strict-Transport-Security` once hostname/TLS behavior is confirmed. |
| Low | k8s README still describes old probe behavior | `k8s/README.md:13`, `k8s/README.md:33`, `k8s/README.md:146` | The manifest correctly uses `/api/livez` for startup/liveness and `/api/health` for readiness, but README still says health probes use `/api/health`, which can reintroduce the old restart-on-DB-blip pattern. | Update docs to match `deployment.yml`. |

## What's solid

- `Dockerfile` is multi-stage, uses `npm ci`, prunes dev dependencies, and runs as non-root (`USER node`).
- `.dockerignore` excludes `.env*`, `.git`, `.github`, `.squad`, `k8s`, local `node_modules`, and build outputs from the image context.
- `docker-compose.yml` handles the known bind-mount/node_modules dev quirk with named volumes for root/api/web dependencies.
- k8s probes are now split correctly: startup/liveness use `/api/livez`, readiness uses DB-gated `/api/health`; resources, topology spread, PDB, service, ingress TLS, and cert-manager annotations are present.
- `build-publish.yml` has test-before-publish, GHCR auth scoped to packages write, Buildx cache, and the new `SEED_ITUNES=false` seed behavior.
- `.gitignore` and `git ls-files` show only env examples are tracked; real `k8s/.env` and `k8s/.env.secret.temp` are ignored.

## Verification performed

- Read-only manifest/source/workflow review across Docker, compose, devcontainer, k8s, package scripts, and GitHub Actions.
- `kubectl kustomize k8s >/dev/null` completed successfully.
- Confirmed `git ls-files` tracks only env example files, not real k8s secret/env files.
- Confirmed no `test/*.test.cjs` files exist and the stale squad test command exits successfully without exercising repo tests.
