// Owner: Rusty (HTTP server setup)
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../config/index.js';
import { initSession } from './middleware.js';
import { registerRoutes } from './routes.js';
import { asyncHandler, sendError } from './middleware.js';
import { stripeWebhookHandler } from '../payments/webhooks.js';
import { PaymentConfigError } from '../payments/provider.js';

declare module 'express-session' {
  interface SessionData {
    userId:      string;
    role:        'guest' | 'admin' | 'dj';
    type:        'guest' | 'account';
    displayName: string;
    organizationId?: string;
    oauthState?: string;
  }
}

export function createApp() {
  const app = express();

  // Behind Traefik/ingress in prod: trust the proxy so req.ip reflects the real client
  // (X-Forwarded-For) for rate limiting and logging, not the load balancer's address.
  app.set('trust proxy', 1);

  app.use(cors({
    origin: cfg.isDev ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : false,
    credentials: true,
  }));

  // Stripe webhook MUST receive the raw body for signature verification, so it is
  // mounted with express.raw BEFORE the global JSON parser (Epic 4, #23/#34/#37).
  app.post('/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    asyncHandler(stripeWebhookHandler));

  app.use(express.json());

  app.use(session({
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Secure cookies in production: Traefik terminates TLS and `trust proxy` is set, so
      // express-session sees X-Forwarded-Proto=https and the cookie is sent only over HTTPS.
      // Kept false in dev where the SPA + API are served over plain http on localhost.
      secure: !cfg.isDev,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }));

  // Auto-initialize session to seeded guest if no session present
  app.use(initSession);

  registerRoutes(app);

  // ── Static SPA (production single-container, #36) ──────────────────────────
  // When WEB_DIST_PATH points at a built frontend, serve its assets and fall back to
  // index.html for any non-/api GET so client-side routing (react-router) works on deep
  // links / refresh. Mounted AFTER the API routes (so /api/* always wins) and BEFORE the
  // error boundary. No-op in dev/tests where the dir is unset (Vite serves the SPA).
  if (cfg.webDistPath && fs.existsSync(cfg.webDistPath)) {
    const indexHtml = path.join(cfg.webDistPath, 'index.html');
    app.use(express.static(cfg.webDistPath));
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(indexHtml);
    });
  }

  // Final catch-all 404 for anything still unmatched (non-/api paths when no SPA is mounted,
  // e.g. dev/tests). Preserves the prior JSON 404 contract for those requests.
  app.use((req: Request, res: Response) => {
    sendError(res, 404, 'not_found', `No route: ${req.method} ${req.originalUrl}`);
  });

  // Terminal error boundary — any error passed to next() (incl. async throws caught by
  // asyncHandler) lands here as a JSON 500 instead of crashing the process or leaking a
  // stack trace. Must be registered AFTER all routes. Express identifies it by arity (4 args).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error('[api] unhandled route error:', err);
    if (res.headersSent) {
      next(err);
      return;
    }
    // Misconfigured payments (missing Stripe keys) → 503, not a generic 500.
    if (err instanceof PaymentConfigError) {
      res.status(503).json({ error: { code: 'payments_unavailable', message: 'Payments are not configured' } });
      return;
    }
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
