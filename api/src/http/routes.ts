// Owner: Rusty (route registration)
import type { Express } from 'express';
import { pool } from '../db/pool.js';
import { cfg } from '../config/index.js';
import { meHandler, actAsHandler } from '../identity/index.js';
import { getQueueHandler, createRequestHandler } from '../queue/index.js';
import { getBundlesHandler } from '../credits/index.js';
import { searchTracksHandler } from '../music/index.js';
import { checkoutSessionStub, checkoutCompleteHandler } from '../payments/index.js';
import { adminGrantHandler, adminAdvanceHandler } from '../admin/index.js';
import { requireAdmin, sendError } from './middleware.js';

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
  app.get('/api/me', meHandler);

  // Dev-only role switcher (disabled in production)
  app.post('/api/dev/act-as', (req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Dev endpoints disabled in production');
      return;
    }
    actAsHandler(req, res);
  });

  // ── Queue ─────────────────────────────────────────────────────────────────
  app.get('/api/events/:slug/queue', getQueueHandler);

  // STUB — core money/state path; Basher implements
  app.post('/api/events/:slug/requests', createRequestHandler);

  // ── Tracks ────────────────────────────────────────────────────────────────
  app.get('/api/tracks/search', searchTracksHandler);

  // ── Credits ───────────────────────────────────────────────────────────────
  app.get('/api/credits/bundles', getBundlesHandler);

  // ── Checkout (stubs — Frank/Basher finalize) ──────────────────────────────
  // Dev-only: these grant real credits with NO payment processor. In production the
  // real path is Frank's Stripe webhook (server-to-server); leaving these ungated
  // would let anyone mint unlimited credits. Gated exactly like /dev/act-as.
  app.post('/api/checkout/session', (req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Stub checkout disabled in production');
      return;
    }
    checkoutSessionStub(req, res);
  });
  app.post('/api/checkout/stub-complete', (req, res) => {
    if (!cfg.isDev) {
      sendError(res, 403, 'forbidden', 'Stub checkout disabled in production');
      return;
    }
    checkoutCompleteHandler(req, res);
  });

  // ── Admin (Basher implements) ─────────────────────────────────────────────
  app.post('/api/admin/credits/grant', requireAdmin, adminGrantHandler);
  app.post('/api/admin/events/:slug/advance', requireAdmin, adminAdvanceHandler);

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.use((req, res) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.path}`);
  });
}
