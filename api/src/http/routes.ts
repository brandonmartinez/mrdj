// Owner: Rusty (route registration)
import type { Express } from 'express';
import { pool } from '../db/pool.js';
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
import { requireAdmin, sendError, asyncHandler } from './middleware.js';

export function registerRoutes(app: Express) {
  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
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

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.use((req, res) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.path}`);
  });
}
