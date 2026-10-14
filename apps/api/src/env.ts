// Copyright (c) 2026, Rademics. All rights reserved.
import { existsSync } from 'node:fs';

/**
 * Loads the repository-root .env file into process.env (development only;
 * on the server the variables are set by the environment). Values already
 * set in the environment are not overwritten.
 */
export function loadRootEnv(): void {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
