# Project Context

- **Owner:** the project owner
- **Project:** mrdj — Jukebox-style social jukebox. Guests request songs into a DJ's live queue, buy credits, and pay to bump (Up Next) or premium-bump (Play Next).
- **Stack:** Node.js · React + Tailwind CSS · PostgreSQL · k3s (Kustomize + Traefik + cert-manager, GHCR)
- **Created:** 2026-06-23

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-06-23: Reference deploy = the reference app's manifests in the cluster infrastructure repo. Pattern: namespace + deployment (image `ghcr.io/brandonmartinez/<app>:latest`, envFrom configmap+secret, `/api/health` probes on container port 3001, requests 64Mi/50m, limits 256Mi/500m, topology spread) + service (80→targetPort) + ingress (Traefik, `cert-manager.io/cluster-issuer: letsencrypt-prod`, `security-redirect-https` middleware, host `<app>.${NETWORK_HOSTNAME_SUFFIX}`, TLS secret) + HPA (min2/max3, CPU 60%) + PDB (minAvailable 1) + Kustomize (configMapGenerator + secretGenerator from .env files).
- 2026-06-23: Cluster already runs a shared PostgreSQL (`data` resource: Postgres + PgBouncer) and Keycloak — options for DB and (later) auth. Public host target: `mrdj.themartinez.cloud`. Open Decision O5: manifests in this repo vs the cluster repo.
