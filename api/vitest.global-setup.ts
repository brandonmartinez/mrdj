import { spawnSync } from 'node:child_process';

export default function globalSetup(): void {
  const result = spawnSync('npm', ['run', 'db:reset'], {
    cwd: process.cwd(),
    env: { ...process.env, SEED_ITUNES: 'false' },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`test database reset failed with exit code ${result.status ?? 'unknown'}`);
  }
}
