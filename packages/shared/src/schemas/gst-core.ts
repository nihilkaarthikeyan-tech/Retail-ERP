// Copyright (c) 2026, Rademics. All rights reserved.
// Module 8 input validation, common core (plan 08 §2 and §5): GST settings,
// the CA's approval, and the buyer of a business tax invoice at the till.
import { z } from 'zod';
import { FILING_FREQUENCIES, FREE_SAMPLE_TAX, GST_SCHEMES, gstinProblem, TURNOVER_BANDS } from '../gst-core.js';
import { isStateCode } from '../india.js';
import { nonNegativeDecimalString } from './catalogue.js';

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const stateCode = z.string().refine(isStateCode, 'Unknown GST state code');

/** Plan 08 §5: what each business sets; the API fills the defaults. */
export const gstSettingsSchema = z
  .object({
    scheme: z.enum(GST_SCHEMES),
    filingFrequency: z.enum(FILING_FREQUENCIES),
    turnoverBand: z.enum(TURNOVER_BANDS),
    hsnDigits: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    eInvoiceApplies: z.boolean(),
    combineSmallSales: z.boolean(),
    freeSampleTax: z.enum(FREE_SAMPLE_TAX),
    receiptTaxTable: z.boolean(),
    eWayLimit: nonNegativeDecimalString,
    eWayStateLimits: z.record(stateCode, nonNegativeDecimalString),
    defaultTransporterId: optionalText(20),
    defaultTransporterName: optionalText(120),
  })
  .partial();
export type GstSettingsInput = z.infer<typeof gstSettingsSchema>;

/** "GST settings approved by the CA" (plan 08 §5, 8.11): who and when are recorded by the API. */
export const gstApprovalSchema = z.object({ note: z.string().trim().min(1, 'Write what the accountant approved').max(500) });
export type GstApprovalInput = z.infer<typeof gstApprovalSchema>;

/** A GSTIN checked with its check character (plan 08 G4). */
export const checkedGstin = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((v, ctx) => {
    const problem = gstinProblem(v, isStateCode);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/**
 * The buyer written on a till bill (plan 08 G4, G5): with a GSTIN the bill is a
 * business tax invoice; without one, name, address and state make a consumer
 * invoice with the buyer's details (needed from ₹50,000 taxable value).
 */
export const posBuyerSchema = z
  .object({
    gstin: checkedGstin.optional().nullable(),
    name: optionalText(120),
    address: optionalText(500),
    stateCode: stateCode.optional().nullable(),
  })
  .refine((b) => !b.gstin || (b.name && b.address), { message: 'A business invoice needs the buyer’s name and address', path: ['name'] });
export type PosBuyerInput = z.infer<typeof posBuyerSchema>;
