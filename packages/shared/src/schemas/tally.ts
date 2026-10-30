// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 part 2 §4: export to Tally (TallyPrime XML import) and the ledger-name map.
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';

const isoDate = z.string().refine(isIsoDate, 'Choose a date');

/** Tally ledger names: no control characters, at most 100 characters (blank = use our account name). */
export const tallyLedgerName = z
  .string()
  .trim()
  .max(100, 'A Tally ledger name can be at most 100 characters')
  .refine((s) => !/[<>]/.test(s) && !s.split('').some((c) => c.charCodeAt(0) < 32),'A Tally ledger name cannot contain < or > or control characters');

export const tallyLedgerMapSchema = z.object({
  rows: z
    .array(z.object({ accountId: z.uuid(), tallyLedger: tallyLedgerName.nullable() }))
    .min(1)
    .max(2000),
});
export type TallyLedgerMapInput = z.infer<typeof tallyLedgerMapSchema>;

export const tallyExportQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  storeId: z.uuid().optional(),
});
export type TallyExportQuery = z.infer<typeof tallyExportQuerySchema>;

/** Our ledger entry kinds and the Tally voucher type each becomes. Anything else is a Journal. */
export const TALLY_VOUCHER_TYPES = ['Sales', 'Purchase', 'Payment', 'Receipt', 'Contra', 'Journal'] as const;
export type TallyVoucherType = (typeof TALLY_VOUCHER_TYPES)[number];
