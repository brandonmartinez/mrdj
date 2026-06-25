# Kubernetes Manifests Location — Decision O5 (#33)

> **Summary:** The cluster GitOps repository is the **canonical** home for mrdj's deployed Kubernetes
> manifests. During the MVP build-out the manifests are **authored and validated in this application
> repo at `k8s/`** (so deployment config evolves alongside the code that needs it). At go-live they are
> **promoted** — copied into the cluster repo, which becomes the single source of truth that the GitOps
> reconciler applies. This is a deliberate **hybrid → cluster-canonical** path: develop here, deploy
> from there. No CI in this repo applies manifests to the cluster.

---

## Status

**Accepted** for the MVP. Resolves Open Decision **O5** (proposed 2026-06-23 as "cluster repo canonical";
confirmed here with the explicit MVP authoring-in-`k8s/` phase that already reflects how the work is
being done). Supersedes the ambiguity noted in `k8s/README.md` ("manifest location TBD — see decision
inbox") and is referenced by all Epic #13 manifest stories (#36, #39, #42, #45, #51).

## Context

mrdj deploys to the project owner's k3s cluster at `mrdj.themartinez.cloud`. That cluster is already
driven by a **GitOps cluster repository** that holds the manifests for every app running on it (a proven
reference app, the shared `data` namespace Postgres+PgBouncer, Keycloak, cert-manager, Traefik). The
question (O5): should mrdj's manifests live **in this app repo**, **in the cluster repo**, or **both**?

Constraints and forces:

- **Single source of truth for what's running.** The cluster reconciler applies from exactly one place.
  Two authoritative copies of a Deployment is an outage waiting to happen (drift, double-apply, "which
  one is live?"). Whatever we choose, the *applied* manifests must have one canonical home.
- **Config co-evolution.** Manifests reference app specifics that change as the code does: container
  port (3000), `/api/health` probe paths, the `RATE_LIMIT_*` / `STRIPE_*` / `MUSIC_PROVIDER` config keys
  consumed via `envFrom`, resource sizing for the realtime + payments workload. Authoring those next to
  the code keeps them honest during rapid epic work and lets the same PR that adds a config key add the
  configMap entry (e.g. #57 added `RATE_LIMIT_*` to both `api/src/config` and `k8s/.env.example`).
- **Secret hygiene.** Real secrets must never enter either git repo. The Kustomize `secretGenerator`
  reads a **gitignored** `k8s/.env.secret.temp`; only `*.example` placeholders are committed.
- **Pattern match.** The reference app on the same cluster keeps its *deployed* manifests in the cluster
  repo. Matching that pattern keeps cluster operations uniform and GitOps-ready.
- **MVP velocity vs. operational discipline.** Pre-launch we are iterating fast on `main` with no
  branches/PRs (standing instruction). Post-launch the deployment surface should be change-controlled
  through the cluster repo's normal PR/promotion process.

## Decision

Adopt a **hybrid authoring model with the cluster repo as canonical**:

1. **Author + validate in this repo (`k8s/`).** The Kustomize bundle (`kustomization.yml`, `deployment.yml`,
   `service.yml`, `ingress.yml`, `pdb.yml`, `namespace.yml`, generator `*.env.example` templates) lives
   here and is the working copy during the MVP. HPA is intentionally absent while the beta remains
   single-replica. Manifest changes are validated with `kubectl kustomize k8s/`; image publication is
   separately gated in CI by migrations, seed, API tests, and build, but **this repo never applies manifests
   to the cluster**.
2. **Cluster repo is canonical for what's deployed.** At go-live the validated bundle is promoted into
   the cluster GitOps repo under its `mrdj` resource path. From then on, the cluster reconciler applies
   **only** the cluster-repo copy. That copy is the single source of truth for the running system.
3. **Promotion workflow (post-launch).** Changes flow `k8s/` → cluster repo via an explicit promotion:
   - Make the change in `mrdj/k8s/`, validate with `kubectl kustomize k8s/`.
   - Open a PR in the **cluster repo** copying the rendered/updated manifests into the `mrdj` path.
     The cluster repo's review + reconcile process is the production change gate.
   - Tag the app image by commit SHA (CI, #36); the cluster-repo PR bumps the image tag. App code and
     deployed image version are thus correlated but independently reviewable.
4. **Secrets never promoted via git.** For beta, `k8s/.env.secret.temp` is generated locally and remains
   gitignored; it is never committed to either repo. Sealed/external secret management is deferred to
   post-beta hardening (#108).

### Why not "this repo canonical (CI applies on push)"

A push-to-deploy pipeline from the app repo would put cluster-mutating credentials in this repo's CI and
create a second authority over the cluster outside its GitOps reconciler. That breaks the cluster's
single-source-of-truth model and its uniform operations across apps. Rejected.

### Why not "cluster repo only (author there from day one)"

Authoring deployment config in a separate repo during fast MVP iteration divorces it from the code that
defines the contract (ports, probes, env keys), inviting drift and slow round-trips. Keeping a validated
working copy in `k8s/` during build-out is strictly better for velocity, and promotion is cheap. The
`k8s/` copy is explicitly **not** applied, so there is no dual-authority problem pre-promotion.

## Consequences

**Positive**
- One authoritative applied source (cluster repo) → no drift/double-apply risk in production.
- Deployment config co-evolves with code during the MVP; same PR can touch config + manifest.
- Matches the cluster's existing reference-app pattern; GitOps-ready, change-controlled at launch.
- Secrets stay out of git in both locations by construction.

**Negative / trade-offs**
- Two copies exist post-launch (working in `k8s/`, canonical in cluster repo); the promotion step must
  be followed or they drift. Mitigation: `k8s/` is documentation/validation-only after launch, and the
  cluster-repo PR is the enforced gate. Consider a CI check (later) that fails if `k8s/` diverges from a
  recorded "last promoted" snapshot.
- Image tag bumps require a cluster-repo PR rather than an automatic deploy. Acceptable: production
  deploys should be deliberate.

**Pre-launch reality (now):** all manifest work for Epic #13 happens in `k8s/` on `main`. No promotion
occurs until we take the product live; this ADR records the target end-state so the manifest stories are
authored with promotion in mind.

## References

- Epic #13 (platform ops/deploy/hardening); story #33 (this decision).
- `k8s/README.md` — bundle overview, build→push→deploy flow, cluster assumptions.
- `.squad/log/2026-06-23T19-26-37-loop-round-1.md` — original O5 framing + recommendation.
- Related ADRs: `docs/decisions/realtime-broker.md`, `docs/decisions/payments-provider.md`.
