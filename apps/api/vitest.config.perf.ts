// Copyright (c) 2026, Rademics. All rights reserved.
// Speed test (docs/performance-test.md): `pnpm perf:seed` fills retail_erp_perf
// with a year of trading, `pnpm perf:measure` times the screens and reports.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['perf/**/*.perf.ts'],
    globalSetup: ['./perf/global-setup.ts'],
    setupFiles: ['./perf/setup-files.ts'],
    fileParallelism: false,
    testTimeout: 24 * 60 * 60_000,
    hookTimeout: 60 * 60_000,
  },
});
