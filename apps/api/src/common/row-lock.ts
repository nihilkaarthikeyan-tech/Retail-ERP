// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 2 (28 October 2026): two requests at once (a double click, a retry) must not post or
// cancel the same document twice. Inside the saving transaction, the document's row is taken
// for update and its status read again; the second request waits, then sees the new status.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Db } from '../audit/audit.service.js';

/** Tables with a status column that documents are posted and cancelled through. */
export type LockedTable = 'StockDocument' | 'GoodsReceipt' | 'Payment' | 'Journal' | 'SupplierBill';

/** Locks the row for the rest of the transaction and returns its status as stored now. */
export async function lockedStatus(tx: Db, table: LockedTable, id: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<{ status: string }[]>(`SELECT "status"::text AS status FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
  if (!rows.length) throw new NotFoundException('Not found');
  return rows[0].status;
}

/** Locks the row and refuses unless its status is still the one the request started from. */
export async function lockStillAt(tx: Db, table: LockedTable, id: string, expected: string | string[], message: string): Promise<void> {
  const now = await lockedStatus(tx, table, id);
  if (!(Array.isArray(expected) ? expected : [expected]).includes(now)) throw new BadRequestException(message);
}

/** Lines whose running counters (received, returned) a cancel writes back. */
export type CounterTable = 'StockDocumentLine' | 'PosBillLine' | 'PurchaseOrderLine' | 'GoodsReceiptLine' | 'SupplierBillLine';

/**
 * Audit 3 (28 October 2026): locks these rows for the rest of the transaction, in id order (so two
 * transactions cannot deadlock), before a counter on them is read and written back.
 */
export async function lockRows(tx: Db, table: CounterTable, ids: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(ids.filter((x): x is string => !!x))].sort();
  if (list.length) await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`, list);
}
