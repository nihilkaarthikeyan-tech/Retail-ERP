// Copyright (c) 2026, Rademics. All rights reserved.
// Module 8 input validation, GST return figures (plan 08 §3): the period
// (a month or a quarter, by the filing frequency setting), the GSTIN and the
// sales tax register's filters.
import { z } from 'zod';
import { gstReturnPeriod } from '../gst-returns.js';
import { isStateCode } from '../india.js';

export const gstReturnQuerySchema = z.object({
  /** "2026-09" or "2026-Q2"; the API takes the current period when left out. */
  period: z
    .string()
    .refine((p) => gstReturnPeriod(p) !== null, 'Choose a month (2026-09) or a quarter (2026-Q2)')
    .optional(),
  /** The GST registration (GSTIN); the API takes the first one the user may see when left out. */
  gstRegistrationId: z.string().uuid().optional(),
  /** Sales tax register only. */
  kind: z.enum(['business', 'consumer']).optional(),
  placeOfSupply: z.string().refine(isStateCode, 'Unknown GST state code').optional(),
});
export type GstReturnQuery = z.infer<typeof gstReturnQuerySchema>;

/**
 * Audit 4 (T15): a return marked as filed on the portal. Bills that arrive
 * later for that month go into the next open month's GSTR-1. A quarterly
 * filer marks the quarter's GSTR-1 (2026-Q2) or the IFF of its first two
 * months (2026-04, 2026-05).
 */
export const gstFiledPeriodSchema = z.object({
  gstRegistrationId: z.string().uuid(),
  period: z.string().refine((p) => gstReturnPeriod(p) !== null, 'Choose a month (2026-09) or a quarter (2026-Q2)'),
  returnType: z.enum(['gstr1', 'iff'], { message: 'Choose GSTR-1 or IFF' }),
  filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the filing date as YYYY-MM-DD'),
});
export type GstFiledPeriodInput = z.infer<typeof gstFiledPeriodSchema>;
