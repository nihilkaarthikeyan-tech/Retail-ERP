// Copyright (c) 2026, Rademics. All rights reserved.
// Module 9 input validation (plan 09).
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';

const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const uuid = z.string().uuid();

/** A yes/no in a query string: only "true" (or "1") is yes; "false", "0" or nothing is no. */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Filters shared by the sales and stock reports; each report uses the ones it needs. */
export const reportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    asOf: isoDate.optional(),
    storeId: uuid.optional(),
    locationId: uuid.optional(),
    itemId: uuid.optional(),
    itemGroupId: uuid.optional(),
    brandId: uuid.optional(),
    customerId: uuid.optional(),
    cashierId: uuid.optional(),
    tillId: uuid.optional(),
    groupBy: z.enum(['item', 'group', 'brand', 'customer', 'store', 'cashier', 'day', 'week', 'month']).optional(),
    rankBy: z.enum(['quantity', 'sales', 'margin']).optional(),
    worst: queryBoolean.optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    /** Days of sales the rate of sale is taken over (stock cover). */
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'The start date is after the end date');
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Figures the owner can choose for the daily summary email (plan 09 §1.5). */
export const SUMMARY_FIGURES = {
  sales_by_store: 'Yesterday’s sales per store, against the same day last week',
  month_to_date: 'Month-to-date sales and gross margin',
  cash_and_bank: 'Cash in tills, cash in hand and bank balances',
  dues: 'What customers owe and what the shop owes suppliers, with overdue amounts',
  reorder: 'Items below their reorder level',
  negative_stock: 'Items sold beyond stock',
  sync_problems: 'Till bills that could not be sent',
} as const;
export type SummaryFigure = keyof typeof SUMMARY_FIGURES;

export const summaryEmailSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Indian time, HH:MM. */
  sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM'),
  recipientIds: z.array(uuid).max(50),
  figures: z.array(z.string().refine((f) => f in SUMMARY_FIGURES, 'Unknown figure')).min(1, 'Choose at least one figure'),
});
export type SummaryEmailSettingsInput = z.infer<typeof summaryEmailSettingsSchema>;

export const exportLogSchema = z.object({
  report: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  rows: z.number().int().min(0).optional(),
});
export type ExportLogInput = z.infer<typeof exportLogSchema>;
