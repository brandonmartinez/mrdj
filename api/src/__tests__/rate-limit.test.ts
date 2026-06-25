/**
 * Epic 9 hardening (#57) — guest abuse / rate limiting.
 *
 * Exercises the limiter middleware directly on a minimal Express app (no DB), so the test is
 * deterministic and independent of cfg.rateLimitEnabled (which is off in dev/test). Asserts the
 * 429 + Retry-After contract, per-IP vs per-session independence, and window reset.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeEach, beforeAll, afterAll, expect } from 'vitest';
import express from 'express';
import session from 'express-session';
import type { Server } from 'node:http';
import { guestRateLimit, rateLimit, ipKey, resetRateLimits } from '../http/rate-limit.js';

const PORT = 3991;
const BASE = `http://localhost:${PORT}`;

// A tiny app: a per-IP+session guest limiter (max 3/IP, 2/session) on /submit, and a raw
// per-IP limiter on /search to assert header math in isolation.
const app = express();
app.set('trust proxy', 1);
app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
app.get('/submit',
  guestRateLimit({ windowMs: 10_000, perIp: 3, perSession: 2, name: 'test-submit' }),
  (_req, res) => res.json({ ok: true }));
app.get('/search',
  rateLimit({ windowMs: 1_000, max: 2, keyFn: ipKey, name: 'test-search' }),
  (_req, res) => res.json({ ok: true }));

let server: Server;
beforeEach(() => { resetRateLimits(); });

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = app.listen(PORT, resolve) as Server; });
});
afterAll(() => { server?.close(); });

async function hit(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return {
    status:     res.status,
    retryAfter: res.headers.get('retry-after'),
    remaining:  res.headers.get('ratelimit-remaining'),
    limit:      res.headers.get('ratelimit-limit'),
    cookie:     res.headers.get('set-cookie'),
  };
}

describe('#57 · guest rate limiting', () => {
  it('returns 429 with Retry-After once the per-session limit is exceeded', async () => {
    // Establish one session and reuse its cookie so the per-session counter accumulates.
    const first = await hit('/submit');
    const cookie = first.cookie?.split(';')[0];
    expect(first.status).toBe(200);

    const second = await hit('/submit', cookie);
    expect(second.status).toBe(200); // session count = 2 (== max, still allowed)

    const third = await hit('/submit', cookie);
    expect(third.status).toBe(429);
    expect(third.retryAfter).toBeTruthy();
    expect(Number(third.retryAfter)).toBeGreaterThan(0);
  });

  it('emits RateLimit-* headers with a decreasing remaining count', async () => {
    const r1 = await hit('/search');
    expect(r1.status).toBe(200);
    expect(r1.limit).toBe('2');
    expect(r1.remaining).toBe('1');

    const r2 = await hit('/search');
    expect(r2.status).toBe(200);
    expect(r2.remaining).toBe('0');

    const r3 = await hit('/search');
    expect(r3.status).toBe(429);
    expect(r3.retryAfter).toBeTruthy();
  });

  it('resets after the window elapses', async () => {
    await hit('/search');
    await hit('/search');
    expect((await hit('/search')).status).toBe(429);

    await new Promise((r) => setTimeout(r, 1_100)); // window = 1s
    expect((await hit('/search')).status).toBe(200);
  });

  it('separate sessions on the same IP get independent session budgets', async () => {
    // Two distinct sessions (no shared cookie). Per-IP cap is 3, per-session cap is 2 — so each
    // session gets 2 before the shared IP cap (3) bites on the combined 4th request.
    const a1 = await hit('/submit'); const cookieA = a1.cookie?.split(';')[0];
    const b1 = await hit('/submit'); const cookieB = b1.cookie?.split(';')[0];
    expect(a1.status).toBe(200);
    expect(b1.status).toBe(200);
    expect(cookieA).not.toBe(cookieB);

    // Third overall request (session A's 2nd) — IP count = 3 (== max), still ok.
    expect((await hit('/submit', cookieA)).status).toBe(200);
    // Fourth overall — IP count = 4 (> max 3) → 429 regardless of session budget.
    expect((await hit('/submit', cookieB)).status).toBe(429);
  });
});
