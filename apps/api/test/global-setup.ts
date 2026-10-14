// Copyright (c) 2026, Rademics. All rights reserved.
// Runs once before the e2e suite: brings the test database up to date with
// the committed migrations (never with `db push`, per reliability rule 10).
import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-env.js';

export default function globalSetup(): void {
  const url = testDatabaseUrl();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
