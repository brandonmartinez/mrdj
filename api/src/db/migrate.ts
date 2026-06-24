// Owner: Rusty (migration runner — wraps node-pg-migrate CLI)
import { config } from 'dotenv';
import { resolve, join } from 'path';
import { execSync } from 'child_process';

config({ path: resolve(process.cwd(), '../.env'), override: false });

const command = process.argv[2] ?? 'up';

// node-pg-migrate may be hoisted to the workspace root by npm workspaces
function resolveBin(): string {
  const candidates = [
    join(process.cwd(), 'node_modules', '.bin', 'node-pg-migrate'),
    join(process.cwd(), '..', 'node_modules', '.bin', 'node-pg-migrate'),
  ];
  const { existsSync } = require('fs');
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'node-pg-migrate'; // fall back to PATH
}

const bin = resolveBin();

function run(cmd: string) {
  execSync(`${bin} ${cmd}`, {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: process.cwd(),
  });
}

if (command === 'reset') {
  console.log('[migrate] Dropping all migrations…');
  try { run('down --count 999 --no-check-order'); } catch {}
  console.log('[migrate] Running all migrations…');
  run('up');
} else {
  run(command);
}
