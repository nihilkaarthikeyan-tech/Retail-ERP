// Copyright (c) 2026, Rademics. All rights reserved.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// One .env file at the repository root holds all local settings.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
