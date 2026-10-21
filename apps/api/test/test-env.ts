// Copyright (c) 2026, Rademics. All rights reserved.
// Points the API at the separate test database (retail_erp_test) so the
// end-to-end tests can wipe tables freely without touching development data.
import { existsSync, readFileSync } from 'node:fs';

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const rootEnv = new URL('../../../.env', import.meta.url);
  let devUrl = process.env.DATABASE_URL;
  if (!devUrl && existsSync(rootEnv)) {
    const line = readFileSync(rootEnv, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('DATABASE_URL='));
    devUrl = line?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
  }
  if (!devUrl) throw new Error('DATABASE_URL not found in the root .env');
  // ".../retail_erp?schema=public" -> ".../retail_erp_test?schema=public"
  const url = new URL(devUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

/** Runs before each test file: force the test database for the whole process. */
export function useTestDatabase(): void {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
  // Emails are kept in memory, never sent (plan 09).
  process.env.MAIL_TRANSPORT = 'memory';
  process.env.SUMMARY_EMAIL_SCHEDULE = 'off';
  // Plan 13: the nightly points and gift card expiry runs only when a test calls it.
  process.env.EXPIRY_SCHEDULE = 'off';
}
