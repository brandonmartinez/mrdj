// Owner: Rusty (route registration)
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cfg } from '../config/index.js';
import { meHandler, actAsHandler } from '../identity/index.js';
import { getQueueHandler, createRequestHandler } from '../queue/index.js';
import { getBundlesHandler } from '../credits/index.js';
import { searchTracksHandler } from '../music/index.js';
import { checkoutSessionStub, checkoutCompleteHandler } from '../payments/index.js';
import { connectOnboardingHandler, connectStatusHandler } from '../payments/connect.js';
import { requireChargesEnabled } from '../payments/guard.js';
import { purchaseHandler } from '../payments/purchase.js';
import { refundHandler } from '../payments/refund.js';
import { orgPaymentsHandler, platformPaymentsHandler } from '../payments/ledger.js';
import {
  listBundlesHandler, createBundleHandler, updateBundleHandler, deleteBundleHandler,
} from '../payments/pricing.js';
import {
  adminGrantHandler,
  adminAdvanceHandler,
  adminReorderHandler,
  adminRemoveHandler,
  adminStatsHandler,
} from '../admin/index.js';
import { streamHandler } from '../realtime/index.js';
import { guestRateLimit } from './rate-limit.js';
import {
  requireAdmin, requirePlatformAdmin, resolveOrg, requireMembership,
  sendError, asyncHandler,
} from './middleware.js';
import {
  createOrgHandler, getOrgHandler, getPublicOrgHandler, updateOrgHandler, listPlatformOrgsHandler,
  listMembersHandler, addMemberHandler, updateMemberHandler, removeMemberHandler,
} from '../org/handlers.js';
import { listMyOrgsHandler, createMyOrgHandler } from '../org/self.js';
import {
  listEventsHandler, getEventHandler, createEventHandler, updateEventHandler,
} from '../event/handlers.js';
import {
  listAreasHandler, createAreaHandler, updateAreaHandler, deleteAreaHandler, listPublicAreasHandler,
} from '../area/index.js';
import { loginStartHandler, authCallbackHandler, logoutHandler } from '../auth/index.js';

export function registerRoutes(app: Express) {
  // ── Guest abuse / rate limiting (#57) ───────────────────────────────────────
  // Coarse per-IP + per-session guards on the two unauthenticated, abuse-prone guest
  // endpoints (request submit + catalog search). Authenticated DJ/org-admin routes are
  // mounted WITHOUT these. No-ops when cfg.rateLimitEnabled is false (dev/tests).
  const requestLimiter = cfg.rateLimitEnabled
    ? guestRateLimit({
        windowMs:   cfg.rateLimitWindowMs,
        perIp:      cfg.rateLimitRequestPerIp,
        perSession: cfg.rateLimitRequestPerSession,
        name:       'request',
      })
    : null;
  const searchLimiter = cfg.rateLimitEnabled
    ? guestRateLimit({
        windowMs:   cfg.rateLimitWindowMs,
        perIp:      cfg.rateLimitSearchPerIp,
        perSession: cfg.rateLimitSearchPerSession,
        name:       'search',
      })
    : null;

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'ok', db: 'error' });
    }
  });

  // ── Identity ──────────────────────────────────────────────────────────────
  app.get('/api/me', asyncHandler(meHandler));

  // ── Auth (Google SSO — Epic 3) ────────────────────────────────────────────
  app.get('/api/auth/google',          asyncHandler(loginStartHandler));
  app.get('/api/auth/google/callback', asyncHandler(authCallbackHandler));
  app.post('/api/auth/logout',         asyncHandler(logoutHandler));

  // Dev-only role switcher (disabled in production)
  app.post('/api/dev/act-as', asyncHandler((req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Dev endpoints disabled in production');
      return;
    }
    return actAsHandler(req, res);
  }));

  // ── Queue ─────────────────────────────────────────────────────────────────
  app.get('/api/events/:slug/queue', asyncHandler(getQueueHandler));
  app.post('/api/events/:slug/requests',
    ...(requestLimiter ? [requestLimiter] : []),
    asyncHandler(createRequestHandler));
  // Public area roster for the guest jukebox area selector (#70).
  app.get('/api/events/:slug/areas', asyncHandler(listPublicAreasHandler));

  // ── Realtime (SSE) — invalidation signal; clients re-fetch their per-user view ──
  app.get('/api/events/:slug/stream', asyncHandler(streamHandler));

  // ── Tracks ────────────────────────────────────────────────────────────────
  app.get('/api/tracks/search',
    ...(searchLimiter ? [searchLimiter] : []),
    asyncHandler(searchTracksHandler));

  // ── Credits ───────────────────────────────────────────────────────────────
  app.get('/api/credits/bundles', asyncHandler(getBundlesHandler));

  // ── Checkout (stubs — Frank/Basher finalize) ──────────────────────────────
  // Dev-only: these grant real credits with NO payment processor. In production the
  // real path is Frank's Stripe webhook (server-to-server); leaving these ungated
  // would let anyone mint unlimited credits. Gated exactly like /dev/act-as.
  app.post('/api/checkout/session', asyncHandler((req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Stub checkout disabled in production');
      return;
    }
    return checkoutSessionStub(req, res);
  }));
  app.post('/api/checkout/stub-complete', asyncHandler((req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Stub checkout disabled in production');
      return;
    }
    return checkoutCompleteHandler(req, res);
  }));

  // ── Admin (Basher implements) ─────────────────────────────────────────────
  app.post('/api/admin/credits/grant',          requireAdmin, asyncHandler(adminGrantHandler));
  app.post('/api/admin/events/:slug/advance',   requireAdmin, asyncHandler(adminAdvanceHandler));
  app.post('/api/admin/events/:slug/reorder',   requireAdmin, asyncHandler(adminReorderHandler));
  app.post('/api/admin/events/:slug/remove',    requireAdmin, asyncHandler(adminRemoveHandler));
  app.get('/api/admin/events/:slug/stats',      requireAdmin, asyncHandler(adminStatsHandler));

  // ── Platform admin (#76) ──────────────────────────────────────────────────
  app.get('/api/admin/platform/orgs', requirePlatformAdmin, asyncHandler(listPlatformOrgsHandler));
  // Aggregate marketplace earnings across all orgs (Epic 4, #48).
  app.get('/api/admin/payments', requirePlatformAdmin, asyncHandler(platformPaymentsHandler));

  // ── Organizations (#71) — O12 /o/{slug}-style path routing ────────────────
  app.post('/api/orgs', requirePlatformAdmin, asyncHandler(createOrgHandler));

  // ── Self-serve org onboarding (Epic 6, #32/#35) ───────────────────────────
  // The current SSO account lists/creates its own organizations (becomes owner).
  app.get('/api/me/orgs',  asyncHandler(listMyOrgsHandler));
  app.post('/api/me/orgs', asyncHandler(createMyOrgHandler));

  // ── Public org landing (Epic 7, #65/#75/#86) — no auth: branding + joinable events + bundles.
  app.get('/api/orgs/:orgSlug/public',
    asyncHandler(resolveOrg()), asyncHandler(getPublicOrgHandler));

  app.get('/api/orgs/:orgSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(getOrgHandler));
  app.patch('/api/orgs/:orgSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(updateOrgHandler));

  // ── Events (Epic 6, #41/#44) — org-scoped CRUD ────────────────────────────
  app.get('/api/orgs/:orgSlug/events',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(listEventsHandler));
  app.post('/api/orgs/:orgSlug/events',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(createEventHandler));
  app.get('/api/orgs/:orgSlug/events/:eventSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(getEventHandler));
  app.patch('/api/orgs/:orgSlug/events/:eventSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(updateEventHandler));

  // ── Stripe Connect onboarding (Epic 4, #20/#23) ───────────────────────────
  app.post('/api/orgs/:orgSlug/stripe/connect',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(connectOnboardingHandler));
  app.get('/api/orgs/:orgSlug/stripe/status',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(connectStatusHandler));

  // ── Per-org credit bundles CRUD (Epic 4, #43) ─────────────────────────────
  app.get('/api/orgs/:orgSlug/bundles',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(listBundlesHandler));
  app.post('/api/orgs/:orgSlug/bundles',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(createBundleHandler));
  app.patch('/api/orgs/:orgSlug/bundles/:bundleId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(updateBundleHandler));
  app.delete('/api/orgs/:orgSlug/bundles/:bundleId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(deleteBundleHandler));

  // ── Guest credit purchase (Epic 4, #30) — destination charge + app fee ─────
  // Guests purchase (no membership required); charges_enabled guard blocks until KYC.
  app.post('/api/orgs/:orgSlug/credits/purchase',
    asyncHandler(resolveOrg()), asyncHandler(requireChargesEnabled()), asyncHandler(purchaseHandler));

  // ── Earnings + refunds (Epic 4, #40/#48) ──────────────────────────────────
  app.get('/api/orgs/:orgSlug/payments',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(orgPaymentsHandler));
  app.post('/api/orgs/:orgSlug/payments/:paymentId/refund',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(refundHandler));

  // ── Memberships (#72) ─────────────────────────────────────────────────────
  app.get('/api/orgs/:orgSlug/members',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(listMembersHandler));
  app.post('/api/orgs/:orgSlug/members',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(addMemberHandler));
  app.patch('/api/orgs/:orgSlug/members/:membershipId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('owner')), asyncHandler(updateMemberHandler));
  app.delete('/api/orgs/:orgSlug/members/:membershipId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('owner')), asyncHandler(removeMemberHandler));

  // ── Areas (#74) ───────────────────────────────────────────────────────────
  app.get('/api/orgs/:orgSlug/events/:eventSlug/areas',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(listAreasHandler));
  app.post('/api/orgs/:orgSlug/events/:eventSlug/areas',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(createAreaHandler));
  app.patch('/api/orgs/:orgSlug/events/:eventSlug/areas/:areaId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(updateAreaHandler));
  app.delete('/api/orgs/:orgSlug/events/:eventSlug/areas/:areaId',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(deleteAreaHandler));

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  // Scoped to /api so unmatched API calls get a JSON 404. Non-/api requests fall through
  // to the static SPA handler (mounted after registerRoutes) for client-side routing; if no
  // SPA is mounted (dev/tests) the server-level handler returns a 404 for those too.
  app.use('/api', (req, res) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.originalUrl}`);
  });
}
