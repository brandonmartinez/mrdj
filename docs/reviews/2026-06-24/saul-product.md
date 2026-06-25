# Saul Product Review — 2026-06-24

## MVP readiness

**Verdict: not launch-ready as written in the PRD.** The core jukebox loop exists at a usable slice level — guests can search, request, buy credits, and spend credits; the backend has org-scoped wallets, Stripe Connect primitives, per-area Play Next locking, and tenant-scoped org/event/member APIs. The gaps are launch-significant: the PRD promises Apple Music + Spotify but the shipped real provider is iTunes with Apple/Spotify still scaffolded; the DJ console is not yet an org-role/area-correct console; production multi-replica operation is blocked by in-memory sessions and in-process realtime; and Stripe has automated coverage plus documentation but the required test-mode smoke issue remains open. A narrower beta could launch only if the PRD is re-scoped to iTunes/single-replica/limited DJ console and #63 is completed.

## Requirements coverage

| Feature | Status | Evidence | Gap |
|---|---|---|---|
| Guest joins event without account | Partial | Public routes in `web/src/App.tsx` (`/o/:orgSlug/events/:eventSlug`); guest session auto-init in `api/src/http/middleware.ts`; guest UI in `web/src/pages/GuestJukebox.tsx` | Guest identity is a generic session user, not clearly event/org-scoped; public org landing exists, but QR/link acceptance is implicit rather than explicit. |
| Google SSO account persistence | Done | `/api/auth/google` and callback in `api/src/http/routes.ts`; provider selection and callback in `api/src/auth/index.ts`; credit merge referenced in callback | Depends on deployed Google env; no product gap found beyond deployment configuration. |
| DJ self-serve organization creation | Done | `POST /api/me/orgs` in `api/src/http/routes.ts`; `createMyOrgHandler` seeds owner membership and pricing in `api/src/org/self.ts`; UI `web/src/pages/Onboarding.tsx` | Acceptable for MVP. |
| Membership roles / invites | Partial | Membership CRUD routes in `api/src/http/routes.ts`; handlers in `api/src/org/handlers.ts`; UI `web/src/pages/Members.tsx` | PRD says invite members; current UI/API require a known `accountId` and explicitly says email invites are coming soon. |
| Platform Admin surface | Partial | Platform org/payment APIs in `api/src/http/routes.ts` and `api/src/payments/ledger.ts`; guard is `requirePlatformAdmin` aliasing global admin | Read-only APIs exist, but no dedicated platform-admin UI/account model; operator role is still represented by global `admin`. |
| Event creation and lead DJ assignment | Partial | Event API supports `leadDjAccountId` in `api/src/event/handlers.ts`; event UI in `web/src/pages/EventsList.tsx` | UI creates events without choosing lead DJ; backend stores `ownerId`, not a role-constrained lead-DJ assignment. |
| Default Area and multi-Area setup | Done | Event creation inserts default Area in `api/src/event/handlers.ts`; Area CRUD in `api/src/area/index.ts`; UI in `web/src/pages/EventManage.tsx` | Default-area creation and area management are present; deletion is appropriately guarded. |
| Guest Area selection / area-scoped request | Done | Public area route in `api/src/area/index.ts`; guest area selector and `areaId` request in `web/src/pages/GuestJukebox.tsx`; queue request resolves `areaId` in `api/src/queue/index.ts` | Guest-side area scoping meets MVP. |
| Song discovery | Partial | Search route `/api/tracks/search`; iTunes provider in `api/src/music/itunes.ts`; provider router in `api/src/music/index.ts` | Docs/PRD require Apple Music + Spotify. `api/src/music/apple.ts` and `spotify.ts` are explicit scaffolds; open issues #17 and #22 remain valid blockers or PRD must be changed. |
| Normal song request into live queue | Done | `POST /api/events/:slug/requests` in `api/src/http/routes.ts`; transactional insert in `api/src/queue/index.ts`; guest modal calls `api.request` in `web/src/components/ConfirmModal.tsx` | Normal request cost defaults to 0; O2 should be documented as decided/free for MVP. |
| Credits / org-scoped wallet | Done | Wallet schema is `(user_id, organization_id)` in `api/src/db/schema.ts`; balance fetch and spend use event org in `api/src/queue/index.ts`; UI shows balance in `GuestJukebox.tsx` | Strong backend coverage. UX has a fallback that temporarily assumes webhook grant after timeout; server still blocks spend if grant has not landed. |
| Buy credits | Partial | Stripe PaymentIntent in `api/src/payments/purchase.ts`; webhook grant in `api/src/payments/webhooks.ts`; Payment Element in `web/src/components/StripeCheckout.tsx`; docs in `docs/testing.md` | Issue #63 test-mode purchase→webhook→grant→balance smoke is still open; launch should not proceed until this is executed and recorded. |
| Paid Up Next bump | Partial | `tier === 'boost'` server-authoritative pricing/reorder in `api/src/queue/index.ts`; UI action in `TrackRow`/`ConfirmModal` | Implemented as a paid insert at the front, not as bumping an existing request owned by the guest. Confirm this product semantics or add true existing-request bump. |
| Premium Play Next | Done | Per-area `play_next_slot` schema in `api/src/db/schema.ts`; lock and slot update in `api/src/queue/index.ts`; reset on advance in `advanceQueue`; UI status/action in `GuestJukebox.tsx` | Meets single-slot/reset requirement at backend; production race behavior appears covered by transaction design. |
| DJ console queue management | Partial | Admin queue endpoints in `api/src/http/routes.ts`; UI controls in `web/src/components/AdminConsole.tsx`; org console page `web/src/pages/DJConsole.tsx` | Console operations use global `requireAdmin`, not org `dj/staff` membership; dedicated DJConsole area picker does not pass `areaId` and displays a warning that queues are shared across the event. This misses PRD's org-scoped per-Area DJ console. |
| Realtime queue updates | Partial | SSE hook in `web/src/hooks/useQueueStream.ts`; in-process service in `api/src/realtime/service.ts` | Works for one process and has polling fallback; multi-replica LISTEN/NOTIFY (#21/#31) remains open. |
| Stripe Connect onboarding / KYC gate | Done | Connect account/link in `api/src/payments/connect.ts`; `requireChargesEnabled` in `api/src/payments/guard.ts`; Earnings CTA in `web/src/pages/Earnings.tsx` | Backend and UI path exist. Need real Stripe smoke (#63). |
| Payouts / earnings | Partial | Destination charge with app fee in `api/src/payments/purchase.ts`; ledger summaries in `api/src/payments/ledger.ts`; UI `web/src/pages/Earnings.tsx` | Ledger/earnings are present; true payout readiness depends on Connect account state and Stripe smoke. |
| Per-org pricing / bundles | Partial | Pricing/bundles schema and defaults in `api/src/payments/pricing.ts`; bundle CRUD UI in `web/src/pages/Pricing.tsx` | Bundle management exists, but UI does not expose action prices (`queue`, `boost`, `play_next`) even though backend reads pricing config. |
| Deployment / k3s readiness | Partial | K8s manifests under `k8s/`; HPA min 2/max 3 in `k8s/horizontalpodautoscaler.yml`; probes in `k8s/deployment.yml` | HPA conflicts with in-memory sessions (#105) and in-process realtime (#21/#31). Either complete shared session/realtime work or run a single-replica beta and update docs. |

## Remaining for MVP (priority order)

1. **Run and record Stripe test-mode E2E (#63)** — prove PaymentIntent → webhook → PlatformPayment → org wallet balance → replay idempotency with real Stripe test infrastructure.
2. **Fix DJ console authorization and area scoping** — org `dj`/`manager` members must operate assigned event Areas, and all console fetch/advance/reorder/remove/stats calls must carry the selected `areaId`.
3. **Resolve music scope drift** — either implement Apple Music and Spotify search/resolve (#17/#22) or officially re-scope MVP docs/backlog to iTunes/one-provider beta.
4. **Resolve production scale blockers** — shared session store (#105) plus LISTEN/NOTIFY fan-out (#21/#31), or reconfigure MVP deployment to one replica and document that constraint.
5. **Close UI acceptance gaps** — email/member invites, lead DJ selection during event creation, and action-price configuration for `queue`/`boost`/`play_next`.
6. **Decide O2/O6/O7 status in docs** — normal requests appear free, O6 appears effectively iTunes-only for MVP, and refund/dispute policy is implemented but decision artifacts/backlog should reflect the final choice.

## Backlog cleanup recommendations

- **Keep open/blocking:** #63, #105, #21/#31, #17, #22 until the above launch decisions are resolved.
- **Reopen or file follow-ups:** #49 appears closed but dedicated `DJConsole` still says multi-area queues are shared; file/reopen for real per-area console. File follow-ups for email invites (#72/#38 acceptance drift), lead DJ selection UI (#41 drift), and action price UI (#54 drift).
- **Re-scope epics:** #8 should remain open until #63 passes; #9 should be re-scoped if iTunes is accepted as MVP provider; #10/#11 should remain open with the console/member/event/pricing acceptance gaps above.
- **Close or mark done after verification:** Closed child stories already implemented should be reflected in parent epic checklists (#8–#11) so open epics show only real remaining work.
- **Future/backlog looks healthy:** #73/#77/#82/#88/#93/#94/#104/#15 correctly capture deferred/non-MVP gold-plating; do not pull them into launch.
