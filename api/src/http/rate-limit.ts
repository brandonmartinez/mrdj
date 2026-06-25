// Owner: Rusty (HTTP hardening — guest abuse / rate limiting, #57)
//
// In-process fixed-window rate limiter. The MVP runs a single API replica, so an in-memory
// counter is sufficient and dependency-free. Under horizontal scale (Epic 9 HPA) each replica
// enforces its own window, so the effective limit is per-replica — acceptable as a coarse abuse
// guard; a shared store (Redis / Postgres) can replace the Map behind this same interface if we
// ever need globally exact limits. Mirrors the realtime broker's "swap the store later" seam.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Max requests permitted per key within the window. */
  max: number;
  /** Derive the bucket key from the request (e.g. client IP or session id). */
  keyFn: (req: Request) => string;
  /** Short label used to namespace keys so multiple limiters never collide. */
  name: string;
}

interface Bucket {
  count:   number;
  resetAt: number; // epoch ms when the window rolls over
}

// One shared store keyed by `${name}:${key}`; entries self-expire and are swept periodically.
const buckets = new Map<string, Bucket>();

// Periodic sweep of expired buckets so the Map can't grow unbounded under churny IPs/sessions.
// unref() so this timer never keeps the process (tests / CLI) alive on its own.
const SWEEP_MS = 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}, SWEEP_MS);
sweeper.unref?.();

/** Test/maintenance hook: drop all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Build a fixed-window rate-limit middleware. On limit breach responds 429 with a `Retry-After`
 * header (seconds) plus the IETF draft `RateLimit-*` headers, and never calls next().
 */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${opts.name}:${opts.keyFn(req)}`;

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, opts.max - bucket.count);
    const resetSec = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSec));

    if (bucket.count > opts.max) {
      res.setHeader('Retry-After', String(resetSec));
      res.status(429).json({
        error: {
          code:    'rate_limited',
          message: 'Too many requests — please slow down.',
          retryAfter: resetSec,
        },
      });
      return;
    }
    next();
  };
}

/** Client IP, honoring the proxy chain (requires `trust proxy` for Traefik/X-Forwarded-For). */
export function ipKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Stable per-browser session identifier. */
export function sessionKey(req: Request): string {
  return req.sessionID ?? ipKey(req);
}

/**
 * Compose per-IP and per-session limiters into one guard. The first limiter to trip wins (429),
 * so a single abusive session and a botnet sharing one NAT'd IP are both contained. Apply only to
 * unauthenticated guest endpoints — authenticated DJ/org-admin routes are mounted without it.
 */
export function guestRateLimit(cfgOpts: {
  windowMs: number;
  perIp: number;
  perSession: number;
  name: string;
}): RequestHandler {
  const byIp = rateLimit({
    windowMs: cfgOpts.windowMs, max: cfgOpts.perIp, keyFn: ipKey, name: `${cfgOpts.name}:ip`,
  });
  const bySession = rateLimit({
    windowMs: cfgOpts.windowMs, max: cfgOpts.perSession, keyFn: sessionKey, name: `${cfgOpts.name}:sess`,
  });
  return (req, res, next) => {
    byIp(req, res, (err?: unknown) => {
      if (err) { next(err); return; }
      if (res.headersSent) return; // IP limiter already responded 429
      bySession(req, res, next);
    });
  };
}
