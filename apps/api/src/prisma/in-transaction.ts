// Copyright (c) 2026, Rademics. All rights reserved.
import type { Db } from '../audit/audit.service.js';

/**
 * Runs `fn` in one database transaction. A caller that is already inside a
 * transaction passes its transaction client and `fn` simply joins it.
 */
export function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = db as Db & { $transaction?: (run: (tx: Db) => Promise<T>) => Promise<T> };
  return client.$transaction ? client.$transaction(fn) : fn(db);
}
