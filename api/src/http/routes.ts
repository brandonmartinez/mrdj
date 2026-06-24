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
import {
  adminGrantHandler,
  adminAdvanceHandler,
  adminReorderHandler,
  adminRemoveHandler,
  adminStatsHandler,
} from '../admin/index.js';
import { streamHandler } from '../realtime/index.js';
import {
  requireAdmin, requirePlatformAdmin, resolveOrg, requireMembership,
  sendError, asyncHandler,
} from './middleware.js';
import {
  createOrgHandler, getOrgHandler, updateOrgHandler, listPlatformOrgsHandler,
  listMembersHandler, addMemberHandler, updateMemberHandler, removeMemberHandler,
} from '../org/handlers.js';
import {
  listAreasHandler, createAreaHandler, updateAreaHandler, deleteAreaHandler,
} from '../area/index.js';

export function registerRoutes(app: Express) {
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
  app.post('/api/events/:slug/requests', asyncHandler(createRequestHandler));

  // ── Realtime (SSE) — invalidation signal; clients re-fetch their per-user view ──
  app.get('/api/events/:slug/stream', asyncHandler(streamHandler));

  // ── Tracks ────────────────────────────────────────────────────────────────
  app.get('/api/tracks/search', asyncHandler(searchTracksHandler));

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

  // ── Organizations (#71) — O12 /o/{slug}-style path routing ────────────────
  app.post('/api/orgs', requirePlatformAdmin, asyncHandler(createOrgHandler));
  app.get('/api/orgs/:orgSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('staff')), asyncHandler(getOrgHandler));
  app.patch('/api/orgs/:orgSlug',
    asyncHandler(resolveOrg()), asyncHandler(requireMembership('manager')), asyncHandler(updateOrgHandler));

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
  app.use((req, res) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.path}`);
  });
}
