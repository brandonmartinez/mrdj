/**
 * Probe endpoint guard (#51). Kubernetes points the startup + liveness probes at
 * /api/livez (process-only, no DB) and the readiness probe at /api/health (DB-gated).
 * This asserts /api/livez exists, returns 200, and does NOT depend on the database — so a
 * transient DB blip can never trigger a pod-restart storm via the liveness probe.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import type { Server } from 'node:http';

const PORT = 3996;
const BASE = `http://localhost:${PORT}/api`;

let server: Server;

beforeAll(async () => {
  vi.resetModules();
  const { createApp } = await import('../http/server.js');
  const app = createApp();
  await new Promise<void>(resolve => {
    server = app.listen(PORT, resolve) as Server;
  });
});

afterAll(async () => {
  server?.close();
  vi.resetModules();
});

describe('probe endpoints', () => {
  it('GET /api/livez → 200 (process-only liveness target)', async () => {
    const res = await fetch(`${BASE}/livez`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/health → 200 with db status (readiness target)', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
  });
});
