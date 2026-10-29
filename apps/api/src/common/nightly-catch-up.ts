// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 6: a nightly job missed because the API was down (an update, a restart) runs once a
// minute after start-up. Each job is safe to run twice in a day. Switched on only on the live
// server (NIGHTLY_CATCH_UP=1), so tests and development never run them by surprise.
import type { Logger } from '@nestjs/common';

export function catchUpAtStart(log: Logger, job: string, run: () => Promise<void>): void {
  if (process.env.NIGHTLY_CATCH_UP !== '1') return;
  const timer = setTimeout(() => {
    run().catch((err: unknown) => log.error(`${job} (catch-up at start-up) failed: ${err instanceof Error ? err.message : String(err)}`));
  }, 60_000);
  timer.unref();
}
