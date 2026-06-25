# Rusty launch readiness summary — 2026-06-24

## 1. Executive summary

**Verdict: not launch-ready for paid public MVP.** The codebase has a credible product spine: guests can search, request, buy/spend credits, orgs can manage events/areas/pricing, Stripe Connect is integrated, and the queue spend path is mostly transactionally sound. But three launch blockers cut across product and engineering: anonymous guests collapse into one wallet, production deployment is configured for multiple replicas while sessions/realtime are process-local, and the Stripe/credit grant/refund path is not yet provably reconciled end-to-end. The smallest thing that ships is a constrained beta: unique guest identity, single-replica or shared sessions, Stripe smoke/reconciliation fixes, and a DJ console that is honest about area scope.

## 2. Top risks — prioritized

| Rank | Severity | Issue | Domain(s) | Root cause | Recommended fix | Owner | Suggested GitHub issue title |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | **P0** | **Anonymous guests share one identity and wallet** — flagged by Basher + Rai | Backend, Safety, Payments, Product | `initSession` assigns every unauthenticated session to seeded `SEED_IDS.guestUser`, so unrelated browsers share wallet/spend authority and requester attribution (`basher-backend.md:11`, `rai-safety.md:11`). | On first anonymous visit, create/load a unique guest user/session row and persist that user id in the session. Keep seeded guest only for dev/tests. Add cross-browser wallet isolation tests. | Basher + Rai | Create unique anonymous guest identities and wallets |
| 2 | **P0** | **Multi-replica production is unsafe with in-memory sessions and process-local realtime** — flagged by Virgil + Saul; known #105/#21/#31 | DevOps, Product, Backend | `express-session` uses the default per-process store while k8s starts at 2 replicas/HPA 2–3; realtime fan-out is also in-process (`virgil-devops.md:11`, `saul-product.md:26`, `saul-product.md:30`). | Smallest launch fix: force `replicas: 1`, disable/remove HPA, document single-pod beta limits. Durable fix: shared Postgres/Redis session store plus LISTEN/NOTIFY or brokered realtime. | Virgil + Basher | Make production session/realtime topology safe before launch |
| 3 | **P0** | **Stripe paid-credit path lacks launch proof and has refund double-remedy risk** — flagged by Frank + Saul | Payments, Product | Credit-only refunds do not terminally close payments, so earnings stay overstated and a later money refund can also happen (`frank-payments.md:11`). Product launch also still depends on real Stripe test-mode smoke #63 (`saul-product.md:34`). | Mark any refund remedy terminal in the same transaction, block money refund after credit remedy, fix earnings exclusion, then run/record purchase → webhook → wallet → replay idempotency smoke. | Frank | Close Stripe MVP smoke and terminal refund semantics |
| 4 | **P0** | **Webhook credit grant trusts mutable Stripe metadata instead of a server-owned purchase record** | Payments, Architecture | The webhook grants credits from PaymentIntent metadata rather than an immutable local purchase row validated against amount/currency/account/bundle (`frank-payments.md:12`). This is the credit-minting contract boundary. | Persist pending purchases keyed by PaymentIntent id at creation. In webhook, grant from local row after validating Stripe amount/currency/status/account. | Frank | Grant credits from server-owned purchase records |
| 5 | **P0** | **Created events lack a Play Next slot** | Backend, Product | Event creation inserts a default area but not its required `play_next_slot`; seeded/later-created areas hide it (`basher-backend.md:12`). This breaks a core premium queue state for newly created events. | Insert the default area's slot in the event-create transaction and regression-test immediate Play Next purchase after event creation. | Basher | Create Play Next slot with every new event default area |
| 6 | **P1** | **DJ console is not area/role correct** — flagged by Linus + Saul | Frontend, Product, Backend | The area selector is UI-only; queue/admin APIs do not receive selected `areaId`, and product review says console operations still miss org-scoped per-area DJ semantics (`linus-frontend.md:15`, `saul-product.md:25`). | Either pass `areaId` through fetch/actions and enforce org DJ/manager authorization, or hide the selector and explicitly scope beta console to event/default area. | Linus + Basher | Make DJ console area-scoped and org-role authorized |
| 7 | **P1** | **Queue idempotency keys are global, not principal-scoped** — flagged by Basher + Rai | Backend, Safety, Payments | Retry lookup by `idempotencyKey` does not constrain user/org/event/operation, allowing replay/leakage across principals (`basher-backend.md:14`, `rai-safety.md:12`). | Key idempotency by `(user_id, organization_id, operation_namespace, idempotency_key)` and return 409 on mismatched operation/principal. | Basher + Rai | Scope queue idempotency keys by principal and operation |
| 8 | **P1** | **Wallet balance is mutable without ledger reconciliation** | Payments, Architecture | Spend/read path uses mutable `wallets.balance`; ledger is append-only but no invariant/job proves wallet equals ledger sum (`frank-payments.md:13`). | Add reconciliation query/job and alert now. Longer term, derive balances from ledger or enforce updates through DB function/trigger. | Frank | Add wallet-ledger reconciliation for credit balances |
| 9 | **P1** | **Provider HTTP can hang guest search and Retry-After can park requests** | Music, Frontend | Live iTunes requests have no timeout; retry sleep honors unbounded provider `Retry-After` (`livingston-music.md:11`, `livingston-music.md:12`). | Add request timeout/budget, clamp Retry-After, and fall back/fail fast with retryable guest UI. | Livingston | Bound music provider latency and retry delays |
| 10 | **P1** | **CI/release workflows run stale no-op tests** | DevOps | Squad workflows call `node --test test/*.test.cjs`, but no matching tests exist and the command exits 0 (`virgil-devops.md:12`). | Replace with repo-native gates: `npm ci`, API tests with DB, and workspace build; reuse `build-publish.yml` pattern. | Virgil | Replace no-op release tests with real repo gates |
| 11 | **P1** | **Frontend failure handling can hide real launch failures** | Frontend | No root error boundary, DELETE 204 parse failures, 401s swallowed as empty data, queue initial-load errors can spin forever (`linus-frontend.md:11`–`linus-frontend.md:14`). | Add root boundary, fix empty-body parsing, centralize 401 handling, and expose queue-load retry/error state. | Linus | Harden frontend error and auth-expiry handling |
| 12 | **P1** | **Music scope drift vs PRD** | Product, Music | PRD promises Apple Music + Spotify, but the real live provider is iTunes; Apple/Spotify are scaffolds (`saul-product.md:19`, `livingston-music.md:5`). | Decide now: re-scope MVP docs/backlog to iTunes beta, or implement Apple/Spotify. I recommend re-scope for MVP. | Saul + Livingston | Re-scope MVP music provider promise to iTunes beta |
| 13 | **P2** | **Privacy/retention and branding tracking gaps** | Safety, Product | Stored emails/payment ledgers lack retention/export/deletion runbook; organizer logo URLs can track guests (`rai-safety.md:13`, `rai-safety.md:14`). | Add lightweight privacy/runbook doc; require HTTPS logo URLs and plan asset proxy/upload later. | Rai | Add MVP privacy retention runbook and logo URL guard |
| 14 | **P2** | **Provider/domain seams leak future complexity** | Music, Architecture | `resolve(providerId)` is not provider-aware; queue items FK directly to provider cache rows, complicating cache eviction (`livingston-music.md:13`, `livingston-music.md:15`). | For MVP, freeze no-eviction behavior. Before multi-provider/cache pruning, resolve by `(provider, providerId)` and separate queued snapshots from cache. | Livingston + Basher | Make music resolve/cache contracts provider-safe |
| 15 | **P2** | **Deployment reproducibility/secrets hardening is unfinished** | DevOps, Safety | Mutable `latest` image tag, local plaintext k8s secret generation, tag-pinned bases, missing standalone healthcheck/HSTS/docs drift (`virgil-devops.md:13`–`virgil-devops.md:18`). | Move to SHA/digest promotion and external/sealed secrets after beta; update docs now where cheap. | Virgil | Harden deployment immutability and secret management |
| 16 | **P2** | **MVP UX/admin acceptance gaps** | Product, Frontend | Email invites, lead-DJ selection, action-price UI, zero-credit bundle validation, dev role switch visibility remain incomplete (`saul-product.md:34`–`saul-product.md:39`, `linus-frontend.md:18`, `linus-frontend.md:19`). | Fix zero-credit validation and hide dev controls before beta. Defer invites/lead-DJ/action-price UI if beta scope explicitly says manager-only/default pricing. | Saul + Linus | Close or defer MVP admin UX acceptance gaps |

## 3. By-domain rollup

### Backend — [Basher](./basher-backend.md)

Headline: backend structure is sane, but production identity and queue lifecycle gaps block launch. **High-count: 2** — shared guest wallet and missing Play Next slot for newly created events.

### Frontend — [Linus](./linus-frontend.md)

Headline: strict TS and basic states are good; resilience and area correctness need tightening. **High-count: 2** — missing root error boundary and 204 handling; I downgraded both from P0 because they hurt reliability, not money/identity integrity.

### Payments — [Frank](./frank-payments.md)

Headline: Stripe/webhook/debit foundations are better than typical MVP, but credit grants/refunds need stronger source-of-truth guarantees. **High-count: 2** — terminal refund semantics and server-owned purchase reconciliation.

### Music — [Livingston](./livingston-music.md)

Headline: iTunes MVP provider is acceptable if product scope changes; latency bounds and provider seams need cleanup. **High-count: 1** — unbounded provider calls can hang request handlers.

### DevOps / Platform — [Virgil](./virgil-devops.md)

Headline: container/k8s baseline is close, but configured scale exceeds app state architecture. **High-count: 2** — in-memory sessions under HPA and no-op release tests.

### Product — [Saul](./saul-product.md)

Headline: usable slice exists, but PRD scope is wider than implementation. **High-count equivalent: 4 launch blockers** — Stripe smoke, DJ console, music provider scope, production scale.

### Safety / Privacy — [Rai](./rai-safety.md)

Headline: no obvious XSS/card-data/secrets disaster, but anonymous identity is a trust blocker. **High-count: 1** — shared anonymous guest identity/wallet.

## 4. Themes

### Anonymous identity model is the keystone

The app is selling credits to public guests, so "guest" cannot mean "one shared seeded user." This poisons wallet ownership, attribution, idempotency risk, Stripe metadata, and safety. Fix this first; several other risks become less severe once principals are real.

### Single-replica statefulness is an architectural mismatch

Sessions and realtime are process-local, but deployment assumes multi-replica. Do not build a distributed system halfway. For MVP, run one replica and say so; then make shared sessions/realtime the next scalability milestone.

### Money path needs one source of truth per transition

Queue debit is mostly correct because it is transactional. Purchases/refunds are weaker because Stripe metadata and mutable wallet balances are treated as truth without enough local invariants. The clean contract is: immutable local purchase row, idempotent webhook grants from that row, terminal refund state, periodic ledger reconciliation.

### Queue state machine has hidden coupling

`play_next_slot`, `areas`, queue items, and track cache rows form one state machine but are created by separate paths. Missing slots and cache-row FKs are symptoms. Keep the state machine small: create all mandatory rows in the same transaction, and avoid letting ephemeral provider cache become durable queue identity.

### MVP scope should shrink, not sprawl

Apple/Spotify, full multi-area DJ operations, email invites, action-price UI, and multi-replica HA are not the smallest launchable set. Ship an honest iTunes/single-replica beta with safe paid guest identity and Stripe proof, then iterate.

## 5. Recommended next actions

1. **Basher + Rai: fix anonymous guest identity.** Unique guest user/session per browser, seeded guest dev/test only, wallet isolation tests. No paid public launch before this.
2. **Virgil + Basher: pick the beta topology.** Fast path: set deployment to one replica, disable HPA, document in k8s README. If not acceptable, implement shared session store and realtime fan-out before launch.
3. **Frank: close the credit contract.** Add terminal refund state for credit remedies, block double remedy, exclude credit-refunded payments from earnings, add pending purchase rows, and run #63 Stripe smoke.
4. **Basher: fix Play Next slot creation.** One transaction: event → default area → play_next_slot. Add regression test.
5. **Linus + Basher: make the DJ console honest.** Smallest beta: remove/disable misleading area selector if per-area actions are not ready. Better beta: pass `areaId` through queue/admin APIs and enforce org role.
6. **Basher + Rai: scope queue idempotency.** Do this after identity fix; otherwise retries remain a cross-user leak vector.
7. **Livingston: bound provider latency.** Add timeout and Retry-After cap so music search cannot exhaust request workers.
8. **Virgil: fix release gates.** Replace no-op squad workflow tests with real API/build gates before promotion automation is trusted.
9. **Saul: re-scope the MVP docs/backlog.** Decide explicitly: iTunes-only beta, single-replica beta, limited DJ console. Do not let the PRD imply Apple/Spotify or HA if we are not shipping them.
10. **Defer P2 polish intentionally.** Privacy runbook, logo URL constraints, deployment immutability, cache/snapshot cleanup, invites, lead-DJ UI, and action-price UI are important but not the first blocker set.

## 6. What's solid

The team is not starting from rubble. Route boundaries are explicit, org scoping is present in most management paths, queue debit/write operations are transactional, Stripe webhooks use raw-body signature verification, React avoids raw HTML rendering, TypeScript/build health is decent, and the Docker/k8s baseline is much better than a throwaway MVP. The product loop is real; the launch work is to make identity, deployment topology, and money contracts boring enough that we can trust them.
