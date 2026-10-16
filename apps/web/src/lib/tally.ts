// Copyright (c) 2026, Rademics. All rights reserved.
// Export to Tally (plan 11 part 2 §4). Shapes mirror apps/api/src/accounting/tally-export.service.ts.

export interface TallyMapRow {
  accountId: string;
  number: string | null;
  name: string;
  kind: string | null;
  active: boolean;
  /** The Tally group the ledger list puts it under. */
  tallyGroup: string;
  /** The Tally ledger name used (our account name unless changed). */
  tallyLedger: string;
  mapped: boolean;
}

export interface TallyMapDto {
  rows: TallyMapRow[];
}

/** The address of the voucher file for a period (and optionally one store). */
export function tallyVouchersPath(from: string, to: string, storeId: string): string {
  const q = new URLSearchParams({ from, to });
  if (storeId) q.set("storeId", storeId);
  return `/tally/vouchers?${q.toString()}`;
}

/** The download name used when the browser cannot read the server's own file name. */
export function tallyFileName(from: string, to: string): string {
  return `tally-vouchers-${from}-to-${to}.xml`;
}

/** The first day of the month of a YYYY-MM-DD date. */
export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** Rows whose Tally name was changed on screen (trimmed; blank means "use our account name"). */
export function changedRows(rows: TallyMapRow[], edits: Record<string, string>): { accountId: string; tallyLedger: string | null }[] {
  return rows
    .filter((r) => r.accountId in edits && (edits[r.accountId].trim() || r.name) !== r.tallyLedger)
    .map((r) => ({ accountId: r.accountId, tallyLedger: edits[r.accountId].trim() || null }));
}
