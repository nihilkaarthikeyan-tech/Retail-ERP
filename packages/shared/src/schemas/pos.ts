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
/** "MM-DD" (plan 11 C10); whether it is a real day is checked by the API. */
const dayMonthShape = z.string().regex(/^\d{2}-\d{2}$/);
const percent = nonNegativeDecimalString.refine((v) => Number(v) <= 100, 'Must be 100 or less');
const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a number such as 12.50');

/** on_account: the customer pays later (module 7 plan §1a, decision 22). */
export const PAYMENT_KINDS = ['cash', 'card', 'upi', 'other', 'on_account'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const APPROVAL_ACTIONS = ['price_change', 'discount', 'return_without_bill', 'cancel_bill', 'open_drawer', 'cash_difference', 'bill_discount', 'credit_over_limit', 'order_refund'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const OFFER_KINDS = ['percent', 'amount', 'special_price', 'free_goods', 'buy_get', 'mix_match'] as const;
export const OFFER_TARGETS = ['items', 'groups', 'brands', 'bill'] as const;

/** Account role each payment kind posts to (module 7). */
export const PAYMENT_ACCOUNT_ROLES: Record<PaymentKind, string> = {
  cash: 'cash_in_till',
  card: 'card_settlement',
  upi: 'upi_settlement',
  other: 'other_receipts',
  on_account: 'customer_receivable',
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
    /** Plan 11 B4: the service item a home-delivery charge is billed as. */
    deliveryItemId: uuid.nullable(),
    /** Plan 11 part 2: the service item an alteration charge is billed as. */
    alterationItemId: uuid.nullable(),
  })
  .partial();
export type PosSettingsInput = z.infer<typeof posSettingsSchema>;

/** Plan 11 B4 (decision 47): a store's delivery charge, none at or above "free above". */
export const storeDeliveryChargesSchema = z.object({
  deliveryCharge: nonNegativeDecimalString,
  deliveryFreeAbove: positiveDecimalString.optional().nullable(),
});
export type StoreDeliveryChargesInput = z.infer<typeof storeDeliveryChargesSchema>;

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
  /** Plan 11 C1: who sold this line, when not the bill's salesperson. */
  salesStaffId: uuid.optional().nullable(),
  charged: chargedFields.optional(),
  /** Plan 11 part 2: a line of the customer order being collected (sold at the agreed price). */
  orderLineId: uuid.optional().nullable(),
});
export type PosLineInput = z.infer<typeof posLineSchema>;

export const DELIVERY_STATUSES = ['pending', 'delivered', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Plan 11 B4 (decision 46): simple home-delivery details on a till bill. */
export const deliveryDetailsSchema = z.object({
  name: optionalText(120),
  address: trimmed(500),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, 'Phone number must be 10 digits')
    .optional()
    .nullable(),
  deliverOn: isoDate.optional().nullable(),
  remarks: optionalText(300),
  /** Offline bills: the delivery charge the till added (kept as charged, pos-offline §5). */
  charge: nonNegativeDecimalString.optional(),
});
export type DeliveryDetailsInput = z.infer<typeof deliveryDetailsSchema>;

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
    /**
     * A customer added on the till (offline too): name + mobile (module 3 quick add), and an optional
     * birthday and anniversary (plan 11 C10). The dates are only shape-checked here: a bill made
     * offline is never refused for them; the API leaves out a date that is not real.
     */
    newCustomer: z
      .object({
        clientId: uuid,
        name: trimmed(120),
        mobile: z.string().regex(/^[0-9]{10}$/),
        birthday: dayMonthShape.optional().nullable(),
        birthYear: z.number().int().optional().nullable(),
        anniversary: dayMonthShape.optional().nullable(),
        anniversaryYear: z.number().int().optional().nullable(),
      })
      .optional(),
    couponCode: optionalText(40),
    billDiscount: z.object({ percent: percent.optional(), amount: nonNegativeDecimalString.optional(), approvalToken: z.string().optional() }).optional(),
    /** Return part: against a bill, or without one (manager approval). */
    ret: billPart.extend({ returnOfId: uuid.optional().nullable(), approvalToken: z.string().optional(), reason: optionalText(200) }).optional(),
    /** A sale with only an alteration charge has no lines of its own (plan 11 part 2). */
    sale: billPart.extend({ lines: z.array(posLineSchema) }).optional(),
    /** Net payments: positive collected, negative refunded. */
    payments: z.array(z.object({ paymentMethodId: uuid, amount: signedDecimal, reference: optionalText(60) })).min(1, 'Record how it was paid'),
    /** The total the till showed (online bills: a different server total is refused so the cashier sees it). */
    expectedTotal: signedDecimal.optional(),
    /** A manager's approval to sell on account above the credit limit or with overdue bills (decision 22). */
    creditApprovalToken: z.string().optional(),
    /** Plan 11 C1: the salesperson of the bill (lines may name their own). */
    salesStaffId: uuid.optional().nullable(),
    /** Plan 11 B4: deliver the sale to the customer's home. */
    delivery: deliveryDetailsSchema.optional().nullable(),
    /** Plan 11 part 2: the customer order collected on this sale; its advance pays part of the bill. */
    orderId: uuid.optional().nullable(),
    /** Plan 11 part 2: how much of the customer's unused credit (advances kept) pays part of the bill. */
    useCredit: nonNegativeDecimalString.optional(),
    /** Plan 11 part 2: an alteration job whose charge is billed on this sale, optionally handed back now. */
    alteration: z.object({ jobId: uuid, deliver: z.boolean().optional() }).optional().nullable(),
  })
  .refine((t) => t.ret || t.sale, 'A bill needs a sale or a return')
  .refine((t) => !t.sale || t.sale.lines.length > 0 || !!t.alteration, { message: 'Add at least one item', path: ['sale', 'lines'] })
  .refine((t) => !t.delivery || t.sale, { message: 'Home delivery is for a sale', path: ['delivery'] });
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

/** Plan 11 C1: sales by salesperson, by day or by month. */
export const salespersonReportQuerySchema = posReportQuerySchema.extend({
  groupBy: z.enum(['day', 'month']).optional(),
  salesStaffId: uuid.optional(),
});
export type SalespersonReportQuery = z.infer<typeof salespersonReportQuerySchema>;

// ---- Sales staff (plan 11 C1: no login; code unique per store) ----

export const salesStaffSchema = z.object({
  storeId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, 'Code must be 1–10 letters or digits'),
  name: trimmed(80),
  active: z.boolean().optional(),
});
export type SalesStaffInput = z.infer<typeof salesStaffSchema>;
export const updateSalesStaffSchema = salesStaffSchema.omit({ storeId: true }).partial();
export type UpdateSalesStaffInput = z.infer<typeof updateSalesStaffSchema>;

// ---- Home deliveries (plan 11 B4) ----

export const deliveryQuerySchema = z.object({
  storeId: uuid.optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type DeliveryQuery = z.infer<typeof deliveryQuerySchema>;

export const deliveryUpdateSchema = z.object({ remarks: optionalText(300) });
export type DeliveryUpdateInput = z.infer<typeof deliveryUpdateSchema>;

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
    /** buy_get: the other item given free (plan 11 B3). */
    freeItemId: uuid.optional().nullable(),
    /** mix_match: any N of the listed items … */
    setQuantity: z.number().int().min(2, 'A set is at least 2 items').max(50).optional().nullable(),
    /** … for a set price … */
    setPrice: positiveDecimalString.optional().nullable(),
    /** … or the cheapest of each set free. */
    cheapestFree: z.boolean().optional(),
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
  .refine((o) => !['free_goods', 'buy_get'].includes(o.kind) || (o.buyQuantity && o.freeQuantity), { message: 'Give "buy" and "free" quantities', path: ['buyQuantity'] })
  .refine((o) => o.kind !== 'buy_get' || !!o.freeItemId, { message: 'Choose the item given free', path: ['freeItemId'] })
  .refine((o) => o.kind !== 'mix_match' || !!o.setQuantity, { message: 'Give how many items make a set', path: ['setQuantity'] })
  .refine((o) => o.kind !== 'mix_match' || !!o.setPrice !== !!o.cheapestFree, { message: 'Give a set price, or choose "cheapest one free"', path: ['setPrice'] })
  .refine((o) => !['percent', 'amount', 'special_price'].includes(o.kind) || o.value != null, { message: 'Give the value', path: ['value'] })
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
