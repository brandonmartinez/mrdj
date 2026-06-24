// Owner: Rusty (route registration)
import type { Express } from 'express';
import { pool } from '../db/pool.js';
import { cfg } from '../config/index.js';
import { meHandler, actAsHandler } from '../identity/index.js';
import { getQueueHandler, createRequestStub } from '../queue/index.js';
import { getBundlesHandler } from '../credits/index.js';
import { searchTracksHandler } from '../music/index.js';
import { checkoutSessionStub, checkoutCompleteStub } from '../payments/index.js';
import { adminGrantStub, adminAdvanceStub } from '../admin/index.js';
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
  app.post('/api/events/:slug/requests', createRequestStub);

  // ── Tracks ────────────────────────────────────────────────────────────────
  app.get('/api/tracks/search', searchTracksHandler);

  // ── Credits ───────────────────────────────────────────────────────────────
  app.get('/api/credits/bundles', getBundlesHandler);

  // ── Checkout (stubs — Frank/Basher finalize) ──────────────────────────────
  app.post('/api/checkout/session', checkoutSessionStub);
  app.post('/api/checkout/stub-complete', checkoutCompleteStub);

  // ── Admin (stubs — Basher implements) ────────────────────────────────────
  app.post('/api/admin/credits/grant', requireAdmin, adminGrantStub);
  app.post('/api/admin/events/:slug/advance', requireAdmin, adminAdvanceStub);

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.use((req, res) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.path}`);
  });
}
