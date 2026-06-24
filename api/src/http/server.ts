// Owner: Rusty (HTTP server setup)
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import cors from 'cors';
import { cfg } from '../config/index.js';
import { initSession } from './middleware.js';
import { registerRoutes } from './routes.js';

declare module 'express-session' {
  interface SessionData {
    userId:      string;
    role:        'guest' | 'admin';
    type:        'guest' | 'account';
    displayName: string;
  }
}

export function createApp() {
  const app = express();

  app.use(cors({
    origin: cfg.isDev ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : false,
    credentials: true,
  }));

  app.use(express.json());

  app.use(session({
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // set true behind HTTPS in prod (Traefik handles TLS)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }));

  // Auto-initialize session to seeded guest if no session present
  app.use(initSession);

  registerRoutes(app);

  // Terminal error boundary — any error passed to next() (incl. async throws caught by
  // asyncHandler) lands here as a JSON 500 instead of crashing the process or leaking a
  // stack trace. Must be registered AFTER all routes. Express identifies it by arity (4 args).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error('[api] unhandled route error:', err);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
