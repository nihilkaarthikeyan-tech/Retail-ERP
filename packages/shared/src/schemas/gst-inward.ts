// Copyright (c) 2026, Rademics. All rights reserved.
// Module 8 input validation for GST on purchases (plan 08 §3): the purchase
// tax register and the upload of the portal's inward statement (GSTR-2B).
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';

const isoDate = z.string().refine(isIsoDate, 'Choose a date');
const period = z.string().regex(/^\d{4}-((0[1-9]|1[0-2])|Q[1-4])$/, 'A period is a month like 2026-09 or a quarter like 2026-Q2');

/** Per GSTIN (decision 64) and for a period, or between two dates. */
export const purchaseTaxRegisterQuerySchema = z
  .object({
    gstRegistrationId: z.uuid().optional(),
    period: period.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    format: z.enum(['json', 'xlsx', 'csv']).optional(),
  })
  .refine((q) => q.period || (q.from && q.to), { message: 'Choose a period, or a from and to date', path: ['period'] });
export type PurchaseTaxRegisterQuery = z.infer<typeof purchaseTaxRegisterQuerySchema>;

export const inwardStatementQuerySchema = z.object({ gstRegistrationId: z.uuid().optional() });
export type InwardStatementQuery = z.infer<typeof inwardStatementQuerySchema>;
