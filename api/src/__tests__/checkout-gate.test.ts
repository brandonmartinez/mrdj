/**
 * Security regression guard for the stub checkout endpoints (PR #1 review, P1).
 *
 * The stub checkout grants real credits with NO payment processor. It must only be
 * reachable in dev. This suite boots an isolated app with NODE_ENV=production
 * (cfg.isDev === false) and asserts both checkout stubs are gated with 403, while a
 * normal endpoint (/api/health) still works — proving the gate is the only difference.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import type { Server } from 'node:http';

const PORT = 3997;
const BASE = `http://localhost:${PORT}/api`;

let server: Server;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  // Fresh module graph under production so cfg.isDev resolves to false.
  process.env.NODE_ENV = 'production';
  vi.resetModules();
  const { createApp } = await import('../http/server.js');
  const app = createApp();
  await new Promise<void>(resolve => {
    server = app.listen(PORT, resolve) as Server;
  });
});

afterAll(async () => {
  server?.close();
  process.env.NODE_ENV = prevNodeEnv;
  vi.resetModules();
});

async function post(path: string, body: object): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.status;
}

describe('stub checkout gating (production)', () => {
  it('serves /api/health (app is up in production mode)', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
  });

  it('POST /api/checkout/session → 403 when not dev', async () => {
    expect(await post('/checkout/session', { bundleId: 'small' })).toBe(403);
  });

  it('POST /api/checkout/stub-complete → 403 when not dev', async () => {
    expect(
      await post('/checkout/stub-complete', { sessionId: 'x', idempotencyKey: 'y' }),
    ).toBe(403);
  });
});
