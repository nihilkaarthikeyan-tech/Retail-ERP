// Copyright (c) 2026, Rademics. All rights reserved.
// Points the speed test at its own database (retail_erp_perf), so a year of
// made-up trading never touches development, test or live data.
import { existsSync, readFileSync } from 'node:fs';

export function perfDatabaseUrl(): string {
  if (process.env.PERF_DATABASE_URL) return process.env.PERF_DATABASE_URL;
  const rootEnv = new URL('../../../.env', import.meta.url);
  let devUrl = process.env.DATABASE_URL;
  if (!devUrl && existsSync(rootEnv)) {
    const line = readFileSync(rootEnv, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('DATABASE_URL='));
    devUrl = line?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
  }
  if (!devUrl) throw new Error('DATABASE_URL not found in the root .env');
  // ".../retail_erp?schema=public" -> ".../retail_erp_perf?schema=public"
  const url = new URL(devUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_perf`;
  return url.toString();
}

/** Runs before each speed-test file: force the speed-test database for the whole process. */
export function usePerfDatabase(): void {
  process.env.DATABASE_URL = perfDatabaseUrl();
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
  process.env.MAIL_TRANSPORT = 'memory';
  process.env.SUMMARY_EMAIL_SCHEDULE = 'off';
}
