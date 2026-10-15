// Copyright (c) 2026, Rademics. All rights reserved.
// Module 6 input validation (plan 06; pos-offline-and-devices plan).
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';
import { DENOMINATIONS } from '../pos.js';
import { nonNegativeDecimalString, positiveDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const percent = nonNegativeDecimalString.refine((v) => Number(v) <= 100, 'Must be 100 or less');
const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a number such as 12.50');

export const PAYMENT_KINDS = ['cash', 'card', 'upi', 'other'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const APPROVAL_ACTIONS = ['price_change', 'discount', 'return_without_bill', 'cancel_bill', 'open_drawer', 'cash_difference', 'bill_discount'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const OFFER_KINDS = ['percent', 'amount', 'special_price', 'free_goods'] as const;
export const OFFER_TARGETS = ['items', 'groups', 'brands', 'bill'] as const;

/** Account role each payment kind posts to (module 7). */
export const PAYMENT_ACCOUNT_ROLES: Record<PaymentKind, string> = {
  cash: 'cash_in_till',
  card: 'card_settlement',
  upi: 'upi_settlement',
  other: 'other_receipts',
};

// ---- GST rate list (decision 56; plan 06 answer 1) ----

export const gstRateSchema = z.object({
  hsnCode: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN code must be 4, 6 or 8 digits'),
  rate: percent,
  cessRate: percent.optional().nullable(),
  effectiveFrom: isoDate,
  note: optionalText(300),
});
export type GstRateInput = z.infer<typeof gstRateSchema>;

// ---- Set-up ----

export const paymentMethodSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, 'Code must be 2–20 letters, digits or _'),
  name: trimmed(60),
  kind: z.enum(PAYMENT_KINDS),
  allowRefund: z.boolean().optional(),
  needsReference: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
export const updatePaymentMethodSchema = paymentMethodSchema.omit({ code: true }).partial();
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export const tillSchema = z.object({
  storeId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, 'Code must be 1–6 letters or digits, e.g. T1'),
  name: trimmed(60),
  locationId: uuid,
  priceListId: uuid,
  cashierDiscountPercent: percent.optional(),
  allowPriceChange: z.boolean().optional(),
  autoPrint: z.boolean().optional(),
  receiptFooter: optionalText(500),
  paymentMethods: z
    .array(z.object({ paymentMethodId: uuid, isDefault: z.boolean().optional() }))
    .min(1, 'Choose at least one payment method')
    .refine((m) => m.filter((x) => x.isDefault).length === 1, 'Choose exactly one default payment method'),
  active: z.boolean().optional(),
});
export type TillInput = z.infer<typeof tillSchema>;
export const updateTillSchema = tillSchema.omit({ storeId: true, code: true }).partial();
export type UpdateTillInput = z.infer<typeof updateTillSchema>;

export const registerDeviceSchema = z.object({ deviceName: trimmed(80) });
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const posSettingsSchema = z
  .object({
    cashDifferenceApprovalAmount: nonNegativeDecimalString,
    printReceiptCopies: z.number().int().min(0).max(3),
    /** Owner only, after the CA approves the GST rates (plan 06 answer 1). */
    liveAllowed: z.boolean(),
  })
  .partial();
export type PosSettingsInput = z.infer<typeof posSettingsSchema>;

// ---- PINs, approvals and cashier switching (decisions 40, 68) ----

export const setPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'The PIN must be 4 to 6 digits'), currentPassword: z.string().min(1) });
export type SetPinInput = z.infer<typeof setPinSchema>;

export const approvalSchema = z.object({
  tillId: uuid,
  managerId: uuid,
  pin: z.string().regex(/^\d{4,6}$/),
  action: z.enum(APPROVAL_ACTIONS),
  /** What is being approved, shown in the history (e.g. "ITM-000001 12%"). */
  details: optionalText(200),
});
export type ApprovalInput = z.infer<typeof approvalSchema>;

export const switchCashierSchema = z.object({ tillId: uuid, userId: uuid, pin: z.string().regex(/^\d{4,6}$/) });
export type SwitchCashierInput = z.infer<typeof switchCashierSchema>;

// ---- Shifts ----

export const openShiftSchema = z.object({
  clientId: uuid,
  tillId: uuid,
  openedAt: instant.optional(),
  cash: z.array(z.object({ paymentMethodId: uuid, amount: nonNegativeDecimalString })).default([]),
});
export type OpenShiftInput = z.infer<typeof openShiftSchema>;

export const cashMovementSchema = z.object({
  clientId: uuid,
  direction: z.enum(['in', 'out']),
  amount: positiveDecimalString,
  reason: trimmed(200),
  at: instant.optional(),
});
export type CashMovementInput = z.infer<typeof cashMovementSchema>;

export const closeShiftSchema = z.object({
  /** Notes and coins counted (decision 41), e.g. { "500": 4, "20": 3 }. */
  denominations: z
    .record(z.string(), z.number().int().min(0))
    .refine((d) => Object.keys(d).every((k) => (DENOMINATIONS as readonly string[]).includes(k)), 'Unknown note or coin'),
  /** Non-cash methods: the total of card slips / UPI confirmations counted. */
  counted: z.array(z.object({ paymentMethodId: uuid, amount: signedDecimal })).default([]),
  remarks: optionalText(500),
  approvalToken: z.string().optional(),
});
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

// ---- Bills (sale, return, exchange) ----

/** What the till charged; the authority for bills made offline (plan pos-offline §5). */
const chargedFields = z.object({
  listPrice: signedDecimal,
  price: signedDecimal,
  discountAmount: nonNegativeDecimalString,
  offerDiscount: nonNegativeDecimalString.optional(),
  gstRate: percent,
  lineTotal: signedDecimal,
});

export const posLineSchema = z.object({
  lineNo: z.number().int().min(1),
  itemId: uuid,
  unitId: uuid.optional(),
  /** Always positive here; returns are told apart by the bill kind. */
  quantity: positiveDecimalString,
  barcode: optionalText(60),
  batchId: uuid.optional().nullable(),
  serialNumbers: z.array(trimmed(60)).optional(),
  /** A price typed by the cashier (needs allowPriceChange or an approval). */
  price: nonNegativeDecimalString.optional(),
  /** A manual discount in percent (above the cashier's limit: an approval). */
  discountPercent: percent.optional(),
  approvalToken: z.string().optional(),
  offerId: uuid.optional().nullable(),
  /** Free line given by an offer on another line of this bill. */
  freeOfLineNo: z.number().int().min(1).optional(),
  /** Returns: the original line. */
  returnOfLineId: uuid.optional().nullable(),
  charged: chargedFields.optional(),
});
export type PosLineInput = z.infer<typeof posLineSchema>;

const billPart = z.object({
  number: trimmed(40),
  lines: z.array(posLineSchema).min(1, 'Add at least one item'),
});

export const posTransactionSchema = z
  .object({
    /** Idempotency key (pos-offline §4): the same transaction sent twice is saved once. */
    clientId: uuid,
    tillId: uuid,
    shiftClientId: uuid.optional(),
    soldAt: instant,
    offline: z.boolean().default(false),
    cashierToken: z.string().optional(),
    customerId: uuid.optional().nullable(),
    /** A customer added on the till (offline too): name + mobile (module 3 quick add). */
    newCustomer: z.object({ clientId: uuid, name: trimmed(120), mobile: z.string().regex(/^[0-9]{10}$/) }).optional(),
    couponCode: optionalText(40),
    billDiscount: z.object({ percent: percent.optional(), amount: nonNegativeDecimalString.optional(), approvalToken: z.string().optional() }).optional(),
    /** Return part: against a bill, or without one (manager approval). */
    ret: billPart.extend({ returnOfId: uuid.optional().nullable(), approvalToken: z.string().optional(), reason: optionalText(200) }).optional(),
    sale: billPart.optional(),
    /** Net payments: positive collected, negative refunded. */
    payments: z.array(z.object({ paymentMethodId: uuid, amount: signedDecimal, reference: optionalText(60) })).min(1, 'Record how it was paid'),
    /** The total the till showed (online bills: a different server total is refused so the cashier sees it). */
    expectedTotal: signedDecimal.optional(),
  })
  .refine((t) => t.ret || t.sale, 'A bill needs a sale or a return');
export type PosTransactionInput = z.infer<typeof posTransactionSchema>;

export const cancelBillSchema = z.object({ reason: trimmed(300), approvalToken: z.string() });
export type CancelBillInput = z.infer<typeof cancelBillSchema>;

export const posBillQuerySchema = z.object({
  tillId: uuid.optional(),
  storeId: uuid.optional(),
  shiftId: uuid.optional(),
  cashierId: uuid.optional(),
  kind: z.enum(['sale', 'return']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type PosBillQuery = z.infer<typeof posBillQuerySchema>;

export const posReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  tillId: uuid.optional(),
  storeId: uuid.optional(),
  cashierId: uuid.optional(),
});
export type PosReportQuery = z.infer<typeof posReportQuerySchema>;

// ---- Offers and coupons (plan 06 answer 2: simple offers + coupons) ----

export const offerSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,30}$/, 'Code must be 2–30 letters, digits, - or _'),
    name: trimmed(120),
    kind: z.enum(OFFER_KINDS),
    appliesTo: z.enum(OFFER_TARGETS),
    targetIds: z.array(uuid).default([]),
    value: nonNegativeDecimalString.optional().nullable(),
    buyQuantity: positiveDecimalString.optional().nullable(),
    freeQuantity: positiveDecimalString.optional().nullable(),
    minQuantity: nonNegativeDecimalString.optional().nullable(),
    minAmount: nonNegativeDecimalString.optional().nullable(),
    storeIds: z.array(uuid).default([]),
    customerGroupId: uuid.optional().nullable(),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    priority: z.number().int().min(0).max(20).default(0),
    couponOnly: z.boolean().default(false),
    active: z.boolean().optional(),
  })
  .refine((o) => !o.endDate || o.endDate >= o.startDate, { message: 'The end date cannot be before the start date', path: ['endDate'] })
  .refine((o) => o.appliesTo === 'bill' || o.targetIds.length > 0, { message: 'Choose the items, groups or brands', path: ['targetIds'] })
  .refine((o) => o.kind !== 'free_goods' || (o.buyQuantity && o.freeQuantity), { message: 'Give "buy" and "free" quantities', path: ['buyQuantity'] })
  .refine((o) => o.kind === 'free_goods' || o.value != null, { message: 'Give the value', path: ['value'] })
  .refine((o) => o.kind !== 'percent' || Number(o.value ?? 0) <= 100, { message: 'A percentage cannot be above 100', path: ['value'] })
  .refine((o) => o.appliesTo !== 'bill' || ['percent', 'amount'].includes(o.kind), { message: 'A whole-bill offer is a percentage or an amount', path: ['kind'] });
export type OfferInput = z.infer<typeof offerSchema>;

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{4,30}$/, 'Code must be 4–30 letters, digits or -'),
    offerId: uuid,
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    maxUses: z.number().int().min(1).optional().nullable(),
    customerId: uuid.optional().nullable(),
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, { message: 'The end date cannot be before the start date', path: ['endDate'] });
export type CouponInput = z.infer<typeof couponSchema>;
