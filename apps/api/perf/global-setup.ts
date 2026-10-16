// Copyright (c) 2026, Rademics. All rights reserved.
// Brings the speed-test database up to date with the committed migrations.
import { execSync } from 'node:child_process';
import { perfDatabaseUrl } from './perf-env.js';

export default function globalSetup(): void {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: perfDatabaseUrl() },
    stdio: 'pipe',
  });
}
