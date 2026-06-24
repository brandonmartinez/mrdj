// Owner: Rusty (entry point)
import { cfg } from './config/index.js';
import { waitForDb, pool } from './db/pool.js';
import { createApp } from './http/server.js';

async function main() {
  console.log('[api] mrdj API starting…');
  console.log(`[api] env=${cfg.nodeEnv} port=${cfg.port}`);

  await waitForDb();
  console.log('[api] Database connected');

  const app = createApp();

  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[api] ✓ Listening on http://localhost:${cfg.port}`);
    console.log(`[api]   GET  http://localhost:${cfg.port}/api/health`);
    console.log(`[api]   GET  http://localhost:${cfg.port}/api/me`);
    console.log(`[api]   GET  http://localhost:${cfg.port}/api/events/demo/queue`);
  });

  process.on('SIGTERM', async () => {
    console.log('[api] SIGTERM received, draining pool…');
    await pool.end();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[api] Fatal startup error:', err);
  process.exit(1);
});
