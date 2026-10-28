// Copyright (c) 2026, Rademics. All rights reserved.
// Module 3 input validation: customers, suppliers, groups, addresses,
// contacts, payment terms and party settings.
import { z } from 'zod';
import { businessDate } from '../business-date.js';
import { PAN_RE, panFromGstin } from '../company.js';
import { dayMonthYearProblem, EARLIEST_CUSTOMER_YEAR, isDayMonth } from '../customer-dates.js';
import { isIsoDate } from '../financial-year.js';
import { CUSTOMER_TAX_SITUATIONS, gstinProblem } from '../gst-core.js';
import { INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE, isStateCode, pinCodeStateProblem } from '../india.js';
import { DUE_BASES } from '../payment-terms.js';
import { itemCode, nonNegativeDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const email = z.string().trim().toLowerCase().email().max(254);
const mobile = z.string().trim().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE);
// Customers' and suppliers' GSTINs get the full check, check character included (see schemas/index.ts).
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((v, ctx) => {
    const problem = gstinProblem(v, isStateCode);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
const pan = z.string().trim().toUpperCase().regex(PAN_RE, 'Not a valid PAN');
const stateCode = z.string().refine(isStateCode, 'Unknown GST state code');
/** Plan 08 G3: empty = worked out from the GSTIN. */
// Audit 4 T5 (owner, 28 October 2026): "exempt buyer" is no longer offered; exemption follows the goods.
const taxSituation = z.enum(CUSTOMER_TAX_SITUATIONS, { message: 'Choose regular, unregistered, SEZ or reverse charge (an exempt buyer is not a GST situation: exemption follows the goods)' }).optional().nullable();

export const PARTY_STATUSES = ['active', 'blocked', 'off'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];
export const HOLD_TYPES = ['none', 'bills', 'payments', 'all'] as const;
export type HoldType = (typeof HOLD_TYPES)[number];

// ---- Addresses and contacts (shared by customers and suppliers) ----

const addressFields = z.object({
  label: optionalText(40),
  addressLine1: trimmed(120),
  addressLine2: optionalText(120),
  city: trimmed(60),
  stateCode,
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits').optional().nullable(),
  phone: optionalText(20),
  email: email.optional().nullable(),
  gstin: gstin.optional().nullable(),
  taxSituation,
  isBilling: z.boolean().optional(),
  isDelivery: z.boolean().optional(),
  isMain: z.boolean().optional(),
});
/** Owner, 28 October 2026: the PIN code must be in the address's state (the state decides CGST + SGST or IGST). */
function checkPinCode(v: { pincode?: string | null; stateCode?: string | null }, ctx: z.RefinementCtx) {
  const problem = pinCodeStateProblem(v.pincode, v.stateCode);
  if (problem) ctx.addIssue({ code: 'custom', path: ['pincode'], message: problem });
}

export const addressSchema = addressFields.superRefine(checkPinCode);
export type AddressInput = z.infer<typeof addressSchema>;
export const updateAddressSchema = addressFields.extend({ active: z.boolean() }).partial().superRefine(checkPinCode);
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const contactSchema = z.object({
  name: trimmed(80),
  jobTitle: optionalText(60),
  email: email.optional().nullable(),
  mobile: mobile.optional().nullable(),
  isMain: z.boolean().optional(),
  noPromotions: z.boolean().optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;
export const updateContactSchema = contactSchema.extend({ active: z.boolean() }).partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// ---- Payment terms ----

const termsPart = z.object({
  share: nonNegativeDecimalString,
  dueBasis: z.enum(DUE_BASES),
  days: z.number().int().min(0).max(365).optional(),
  months: z.number().int().min(0).max(24).optional(),
  earlyDiscountPercent: nonNegativeDecimalString.optional().nullable(),
  earlyDiscountDays: z.number().int().min(0).optional().nullable(),
});

export const createPaymentTermsSchema = z.object({
  code: itemCode,
  name: trimmed(60),
  parts: z.array(termsPart).min(1),
});
export type CreatePaymentTermsInput = z.infer<typeof createPaymentTermsSchema>;
export const updatePaymentTermsSchema = z.object({ name: trimmed(60), parts: z.array(termsPart).min(1), active: z.boolean() }).partial();
export type UpdatePaymentTermsInput = z.infer<typeof updatePaymentTermsSchema>;

// ---- Groups ----

export const createCustomerGroupSchema = z.object({
  code: itemCode,
  name: trimmed(80),
  parentId: z.string().uuid().optional().nullable(),
  priceListId: z.string().uuid().optional().nullable(),
  paymentTermsId: z.string().uuid().optional().nullable(),
  creditLimit: nonNegativeDecimalString.optional(),
  overdueLimit: nonNegativeDecimalString.optional(),
  skipCreditCheck: z.boolean().optional(),
});
export type CreateCustomerGroupInput = z.infer<typeof createCustomerGroupSchema>;
export const updateCustomerGroupSchema = createCustomerGroupSchema.omit({ code: true, parentId: true }).extend({ active: z.boolean() }).partial();
export type UpdateCustomerGroupInput = z.infer<typeof updateCustomerGroupSchema>;

export const createSupplierGroupSchema = z.object({
  code: itemCode,
  name: trimmed(80),
  parentId: z.string().uuid().optional().nullable(),
  priceListId: z.string().uuid().optional().nullable(),
  paymentTermsId: z.string().uuid().optional().nullable(),
});
export type CreateSupplierGroupInput = z.infer<typeof createSupplierGroupSchema>;
export const updateSupplierGroupSchema = createSupplierGroupSchema.omit({ code: true, parentId: true }).extend({ active: z.boolean() }).partial();
export type UpdateSupplierGroupInput = z.infer<typeof updateSupplierGroupSchema>;

// ---- Customers ----

/** Plan 11 C10: a birthday or anniversary is a day and month ("MM-DD"); the year is optional. */
const dayMonth = z.string().trim().refine(isDayMonth, 'Not a real day and month (MM-DD)');
const year = z.number().int().min(EARLIEST_CUSTOMER_YEAR, `The year must be ${EARLIEST_CUSTOMER_YEAR} or later`).max(9999);
const customerDates = {
  birthday: dayMonth.optional().nullable(),
  birthYear: year.optional().nullable(),
  anniversary: dayMonth.optional().nullable(),
  anniversaryYear: year.optional().nullable(),
};
type CustomerDates = { birthday?: string | null; birthYear?: number | null; anniversary?: string | null; anniversaryYear?: number | null };

/**
 * The year must go with a day and month, may not be in the future, and 29 February needs a leap year.
 * When only the year is sent (a change), the API checks it against the saved day and month.
 */
function checkCustomerDates(v: CustomerDates, ctx: z.RefinementCtx) {
  for (const [dm, yr] of [
    ['birthday', 'birthYear'],
    ['anniversary', 'anniversaryYear'],
  ] as const) {
    if (v[dm] === undefined) continue;
    const problem = dayMonthYearProblem(v[dm], v[yr] ?? null, businessDate());
    if (problem) ctx.addIssue({ code: 'custom', path: [problem.startsWith('Give') || problem.startsWith('Not') ? dm : yr], message: problem });
  }
}

const customerBody = z.object({
  code: itemCode.optional(),
  name: trimmed(120),
  isBusiness: z.boolean().optional(),
  mobile: mobile.optional().nullable(),
  email: email.optional().nullable(),
  notes: optionalText(1000),
  customerGroupId: z.string().uuid().optional(),
  gstin: gstin.optional().nullable(),
  taxSituation,
  stateCode: stateCode.optional().nullable(),
  priceListId: z.string().uuid().optional().nullable(),
  paymentTermsId: z.string().uuid().optional().nullable(),
  creditCheckAtDelivery: z.boolean().optional(),
  linkedSupplierId: z.string().uuid().optional().nullable(),
  ...customerDates,
  /** Decision 20: a duplicate mobile is refused unless the user confirms. */
  confirmDuplicate: z.boolean().optional(),
});

export const createCustomerSchema = customerBody
  .extend({
    address: addressSchema.optional().nullable(),
  })
  .superRefine(checkCustomerDates);
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const quickAddCustomerSchema = z
  .object({
    name: trimmed(120),
    mobile,
    email: email.optional().nullable(),
    /** Plan 11 C10: optional at the till's quick add. */
    ...customerDates,
    confirmDuplicate: z.boolean().optional(),
  })
  .superRefine(checkCustomerDates);
export type QuickAddCustomerInput = z.infer<typeof quickAddCustomerSchema>;

export const updateCustomerSchema = customerBody.omit({ code: true }).partial().superRefine(checkCustomerDates);
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/** Credit controller only (customers.credit). */
export const customerCreditSchema = z
  .object({
    creditLimit: nonNegativeDecimalString,
    overdueLimit: nonNegativeDecimalString,
    status: z.enum(PARTY_STATUSES),
    reason: optionalText(200),
  })
  .partial();
export type CustomerCreditInput = z.infer<typeof customerCreditSchema>;

export const customerQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(PARTY_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

// ---- Suppliers ----

const supplierBody = z.object({
  code: itemCode.optional(),
  name: trimmed(120),
  isBusiness: z.boolean().optional(),
  mobile: mobile.optional().nullable(),
  email: email.optional().nullable(),
  notes: optionalText(1000),
  supplierGroupId: z.string().uuid().optional(),
  isTransporter: z.boolean().optional(),
  gstin: gstin.optional().nullable(),
  taxSituation,
  pan: pan.optional().nullable(),
  stateCode: stateCode.optional().nullable(),
  priceListId: z.string().uuid().optional().nullable(),
  paymentTermsId: z.string().uuid().optional().nullable(),
  bankAccountNote: optionalText(120),
  allowBillWithoutOrder: z.boolean().optional(),
  allowBillWithoutReceipt: z.boolean().optional(),
  linkedCustomerId: z.string().uuid().optional().nullable(),
});

/**
 * Owner, 28 October 2026: characters 3 to 12 of a GSTIN are the business's PAN, so a PAN and a
 * GSTIN given together must agree. When a change sends only one, the API checks it against the other.
 */
export function supplierPanProblem(pan: string | null | undefined, gstin: string | null | undefined): string | null {
  const p = pan?.trim().toUpperCase();
  const g = gstin?.trim().toUpperCase();
  if (!p || !g || g.length !== 15 || panFromGstin(g) === p) return null;
  return `This GSTIN belongs to PAN ${panFromGstin(g)}, not ${p}. Check the PAN or the GSTIN.`;
}

function checkSupplierPan(v: { pan?: string | null; gstin?: string | null }, ctx: z.RefinementCtx) {
  const problem = supplierPanProblem(v.pan, v.gstin);
  if (problem) ctx.addIssue({ code: 'custom', path: ['pan'], message: problem });
}

export const createSupplierSchema = supplierBody.extend({ address: addressSchema.optional().nullable() }).superRefine(checkSupplierPan);
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export const updateSupplierSchema = supplierBody.omit({ code: true }).partial().superRefine(checkSupplierPan);
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/** suppliers.hold only. */
export const supplierHoldSchema = z
  .object({
    holdType: z.enum(HOLD_TYPES),
    holdUntil: isoDate.nullable(),
    holdReason: optionalText(200),
    status: z.enum(PARTY_STATUSES),
    /** Why the status or hold changed; kept in the history. */
    reason: optionalText(200),
  })
  .partial();
export type SupplierHoldInput = z.infer<typeof supplierHoldSchema>;

export const supplierQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(PARTY_STATUSES).optional(),
  transporters: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type SupplierQuery = z.infer<typeof supplierQuerySchema>;

// ---- Settings ----

export const updatePartySettingsSchema = z
  .object({
    defaultCustomerGroupId: z.string().uuid().nullable(),
    defaultSupplierGroupId: z.string().uuid().nullable(),
    defaultPaymentTermsId: z.string().uuid().nullable(),
    defaultCreditLimit: nonNegativeDecimalString,
    gstTreatmentFrom: z.enum(['billing', 'delivery']),
  })
  .partial();
export type UpdatePartySettingsInput = z.infer<typeof updatePartySettingsSchema>;
