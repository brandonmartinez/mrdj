# mrdj Pre-Launch Security Review (#68)

> **Scope:** RBAC correctness, input validation / injection, secrets hygiene, and cross-org
> (tenant) isolation for `mrdj.themartinez.cloud` before it is opened to the public. This review
> audited the live codebase (not a checklist in the abstract); findings and the fixes applied are
> recorded below with file references so they can be re-verified.
>
> **Outcome:** No critical or high-severity issues outstanding. Two hardening fixes were made
> during the review (secure session cookie in prod; fail-fast on a weak session secret). Remaining
> items are operational (secret provisioning/rotation at deploy time), tracked below.

---

## 1. RBAC audit — every protected route enforces the correct role

**Method:** read every route registration in `api/src/http/routes.ts` and the guards in
`api/src/http/middleware.ts`.

| Surface | Guard | Evidence |
|---------|-------|----------|
| Event admin (advance/reorder/remove/stats/grant) | `requireAdmin` | `routes.ts` 133–137 |
| Platform admin (org list, marketplace payments) | `requirePlatformAdmin` | `routes.ts` 140–142, 145 |
| Org read (staff+) | `resolveOrg()` → `requireMembership('staff')` | `routes.ts` 157, 162, 166, 175 |
| Org write (manager+) | `resolveOrg()` → `requireMembership('manager')` | `routes.ts` 159, 164, 168, 172, 215 |
| Self-serve org create/list | session account only (becomes owner) | `routes.ts` 149–150 |
| Public (queue read, request, search, areas, org landing) | none by design (guest-facing) | `routes.ts` 95–108, 153 |

- **`requireMembership`** looks up membership for the **specific** resolved org + session user and
  403s if absent or under-privileged (`middleware.ts` 84–104). Membership in *another* org grants
  nothing — this is the cross-org enforcement point (see §4).
- **`requireAdmin` / `requirePlatformAdmin`** return 403 on missing role (`middleware.ts` 38+).
- **No `act-as` in production.** The dev role-switcher (`POST /api/dev/act-as`) and the stub
  checkout endpoints (`/api/checkout/session`, `/api/checkout/stub-complete`) — which would
  otherwise let anyone assume admin or mint unlimited credits — are hard-gated behind `!cfg.isDev`
  and return 403 in production (`routes.ts` 86–92, 117–130). `cfg.isDev` is driven by
  `NODE_ENV`, which the production configMap pins to `production`.

**Result: PASS.** Every privileged route has an enforcing guard; all dev/test backdoors are
disabled in production.

## 2. Input validation & injection

- **SQL injection: not possible via the ORM path.** All persistence goes through Drizzle ORM.
  The audited raw-SQL sites (`payments/webhooks.ts`, `queue/index.ts`, `auth/service.ts`,
  `org/handlers.ts`, `queue/auto-advance.ts`, the `/api/health` `SELECT 1`) use Drizzle's tagged
  `sql\`\`` template, where every interpolated user value (`${chargeId}`, `${cost}`, …) is sent as a
  **bound parameter**, not string-concatenated. The only literals inside `sql\`\`` are fixed
  constants (e.g. `WHEN 'live'` in an ORDER BY CASE), never user input.
- **Stripe webhooks** verify the signature against `STRIPE_WEBHOOK_SECRET` on the **raw** body
  before any processing (`server.ts` mounts `express.raw` for that route ahead of the JSON parser),
  preventing forged payment events.
- **Body parsing** is JSON-only with Express's default size limit; handlers read typed fields and
  resolve entities by id/slug (404 on miss) rather than trusting client-supplied scoping.

**Result: PASS** for injection. *Recommendation (non-blocking):* adopt a schema validator (e.g.
zod) at the HTTP boundary for defense-in-depth on shape/range of guest-supplied fields; today
validation is per-handler and type-driven.

## 3. Secrets hygiene

- **No secrets in the repo or its history.** `git ls-files` tracks only `*.example` env files; a
  history scan for `sk_live_…`, `whsec_…`, AWS keys, and PEM private-key headers found **no real
  secret material** (only documentation strings describing scan patterns).
- **No secrets in manifests.** Kustomize `secretGenerator` reads gitignored
  `k8s/.env.secret.temp`; `.gitignore` blocks `k8s/.env` and `k8s/.env.secret.temp`
  (`git check-ignore` confirms). Committed `*.example` files hold placeholders only.
- **Fix applied — weak session secret fail-fast.** The app now refuses to boot in production if
  `SESSION_SECRET` is unset, the dev default, or shorter than 16 chars (`api/src/index.ts`). A
  predictable secret would let an attacker forge session cookies.
- **Secret coverage** (`k8s/.env.secret.example`): `DATABASE_URL`, `SESSION_SECRET`,
  `GOOGLE_CLIENT_ID/SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Result: PASS** for repo hygiene. **Operational action before launch (owner):** provision real
values into `k8s/.env.secret.temp` (or a sealed/external secret) and **rotate** any keys that were
ever used in development. This is a deploy-time task, not a code gap.

## 4. Cross-org (tenant) isolation

- **Enforcement:** every org-scoped route is `resolveOrg()` (slug → org, 404 if unknown) followed
  by `requireMembership(role)`, which authorizes against **that org's** membership for the session
  user (`middleware.ts` 62–104). There is no code path that scopes a query by a client-supplied org
  id without first passing this guard.
- **Regression coverage:** `api/src/__tests__/tenancy.test.ts` and `org6.test.ts` assert that a
  member of org A receives 403/404 on org B's resources, and `multi-area.test.ts` asserts an event
  cannot reference another event's area (404). Full suite green (see §6).

**Result: PASS.** App-level tenant scoping is enforced uniformly and covered by tests.
*Note:* database Row-Level Security (#62) is a deferred **defense-in-depth** layer for post-launch;
the app-level boundary above is the primary control for the MVP.

## 5. Transport / session hardening

- **Fix applied — secure cookies in production.** The session cookie was hardcoded
  `secure: false`; it is now `secure: !cfg.isDev` (`api/src/http/server.ts`). With Traefik
  terminating TLS and `app.set('trust proxy', 1)`, express-session sees `X-Forwarded-Proto=https`
  and only sends the cookie over HTTPS in prod. `httpOnly: true` and `sameSite: 'lax'` were already
  set (mitigating XSS cookie theft and most CSRF).
- **Rate limiting** on the unauthenticated guest endpoints is in place (#57) to blunt abuse.
- **TLS** is provided by cert-manager (`letsencrypt-prod`) via the Traefik ingress; the ingress
  applies the HTTPS-redirect middleware.

## 6. Verification

- API suite **120/120 green**; `tsc` clean (excluding the pre-existing unrelated
  `music.test.ts` import.meta note) after both hardening fixes.
- The dev/act-as and stub-checkout gates were read directly; the secure-cookie and session-secret
  guards are scoped to `!cfg.isDev`, so dev/test behavior is unchanged.

## 7. Outstanding / deferred (not launch-blocking code gaps)

| Item | Type | Owner |
|------|------|-------|
| Provision real secrets + rotate dev keys | Operational (deploy-time) | Owner |
| Postgres Row-Level Security (#62) | Defense-in-depth, post-launch | Rusty |
| Schema validation (zod) at HTTP boundary | Hardening, non-blocking | Rusty |
| Shared session store for multi-replica (sessions are in-memory today) | Scale hardening | tied to #21/#31 |

## Sign-off

Codebase audit complete; the four acceptance areas (RBAC, input validation, secrets, org boundary)
PASS with two hardening fixes applied during review. Remaining items are operational or explicitly
deferred. Recommended for launch once the deploy-time secret provisioning/rotation is done.

_Refs: `api/src/http/routes.ts`, `api/src/http/middleware.ts`, `api/src/http/server.ts`,
`api/src/index.ts`, `api/src/__tests__/{tenancy,org6,multi-area}.test.ts`, `k8s/`._
