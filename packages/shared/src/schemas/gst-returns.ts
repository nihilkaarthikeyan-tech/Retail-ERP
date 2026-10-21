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
