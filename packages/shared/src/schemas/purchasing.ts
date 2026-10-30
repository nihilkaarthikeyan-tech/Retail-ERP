// Copyright (c) 2026, Rademics. All rights reserved.
// Module 5 input validation: purchase orders, goods receipts, supplier bills,
// returns, extra charges, reorder suggestions and settings (plan 05).
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';
import { decimalString, nonNegativeDecimalString, positiveDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Choose a date');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
const uuid = z.string().uuid();
const percent = nonNegativeDecimalString.refine((v) => Number(v) <= 100, 'Must be 100 or less');

export const ORDER_STATUSES = ['draft', 'to_receive_and_bill', 'to_receive', 'to_bill', 'completed', 'on_hold', 'closed', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof ORDER_STATUSES)[number];
export const RECEIPT_STATUSES = ['draft', 'to_bill', 'partly_billed', 'completed', 'returned', 'closed', 'cancelled'] as const;
export type GoodsReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const BILL_STATUSES = ['draft', 'unpaid', 'cancelled'] as const;
export const BILL_KINDS = ['against_receipt', 'receives_goods', 'services', 'debit_note'] as const;
export type SupplierBillKind = (typeof BILL_KINDS)[number];
export const CHECK_RESULTS = ['passed', 'passed_with_remarks', 'failed'] as const;
export const CHARGE_TYPES = ['freight', 'loading', 'insurance', 'other'] as const;
export const SHARE_BY = ['quantity', 'value', 'manual'] as const;
export const PRICE_MISMATCH = ['allow', 'warn', 'block'] as const;

/** Account roles stored on purchase lines; module 7 posts them (plan 05 §2). */
export const PURCHASE_ACCOUNT_ROLES = {
  stock: 'stock',
  grni: 'goods_received_not_billed',
  payable: 'supplier_payable',
  gstInput: 'gst_input',
  expense: 'purchase_expense',
  /** Plan 11 part 2: sale-or-return goods, owed only once sold. */
  consignment: 'consignment_payable',
  freight: 'freight_inward',
  priceDifference: 'purchase_price_difference',
  rounding: 'rounding',
} as const;

/** GST as written on the supplier's document; omitted amounts are suggested from the rate, an omitted rate from the last purchase. */
const gstFields = {
  gstRate: percent.optional(),
  cgst: nonNegativeDecimalString.optional(),
  sgst: nonNegativeDecimalString.optional(),
  igst: nonNegativeDecimalString.optional(),
};

const priceFields = {
  /** Buying price per line unit before GST; filled from the price list / last purchase price when left out. */
  rate: nonNegativeDecimalString.optional(),
  discountPercent: percent.optional().nullable(),
  discountAmount: nonNegativeDecimalString.optional().nullable(),
};

const batchFields = {
  batchId: uuid.optional().nullable(),
  batchNumber: optionalText(60),
  manufactureDate: isoDate.optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
};

// ---- Purchase orders ----

export const purchaseOrderLineSchema = z.object({
  /** When changing an order: the existing line this replaces (lines with goods received or billed must keep theirs). */
  lineId: uuid.optional(),
  itemId: uuid,
  unitId: uuid.optional(),
  quantity: positiveDecimalString,
  freeQuantity: nonNegativeDecimalString.optional().nullable(),
  ...priceFields,
  ...gstFields,
  /** Store the line is delivered to; defaults to the order's store. */
  storeId: uuid.optional().nullable(),
  neededBy: isoDate.optional().nullable(),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

export const createPurchaseOrderSchema = z.object({
  supplierId: uuid,
  orderDate: isoDate.optional(),
  neededBy: isoDate,
  storeId: uuid,
  supplierQuoteRef: optionalText(60),
  paymentTermsId: uuid.optional().nullable(),
  remarks: optionalText(500),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Add at least one item'),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = createPurchaseOrderSchema.partial().extend({
  /** Reason when changing a finalised order (logged). */
  changeReason: optionalText(300),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const reasonSchema = z.object({ reason: trimmed(300) });
export type ReasonInput = z.infer<typeof reasonSchema>;

export const purchaseOrderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  supplierId: uuid.optional(),
  storeId: uuid.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type PurchaseOrderQuery = z.infer<typeof purchaseOrderQuerySchema>;

// ---- Goods receipts ----

export const goodsReceiptLineSchema = z
  .object({
    orderLineId: uuid.optional().nullable(),
    itemId: uuid,
    unitId: uuid.optional(),
    /** Everything that arrived, free units included; = accepted + rejected. */
    receivedQuantity: positiveDecimalString,
    /** Of the received units, how many came free (decision 27). */
    freeQuantity: nonNegativeDecimalString.optional().nullable(),
    rejectedQuantity: nonNegativeDecimalString.optional().nullable(),
    ...priceFields,
    ...gstFields,
    shelfLocationId: uuid.optional().nullable(),
    ...batchFields,
    serialNumbers: z.array(trimmed(60)).optional(),
    rejectedSerialNumbers: z.array(trimmed(60)).optional(),
  })
  .refine((l) => Number(l.rejectedQuantity ?? 0) <= Number(l.receivedQuantity), { message: 'Rejected cannot be more than received', path: ['rejectedQuantity'] })
  .refine((l) => Number(l.freeQuantity ?? 0) <= Number(l.receivedQuantity), { message: 'Free cannot be more than received', path: ['freeQuantity'] });
export type GoodsReceiptLineInput = z.infer<typeof goodsReceiptLineSchema>;

export const createGoodsReceiptSchema = z.object({
  supplierId: uuid,
  storeId: uuid,
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  deliveryNoteNo: optionalText(60),
  transporterName: optionalText(120),
  vehicleNo: optionalText(30),
  /** Decision 31: required when no line comes from an order. */
  noOrderReason: optionalText(300),
  /** Plan 11 part 2: sale or return; owed to the supplier only once sold (consignment statement). */
  isConsignment: z.boolean().optional(),
  remarks: optionalText(500),
  lines: z.array(goodsReceiptLineSchema).min(1, 'Add at least one item'),
});
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;

export const updateGoodsReceiptSchema = createGoodsReceiptSchema.partial();
export type UpdateGoodsReceiptInput = z.infer<typeof updateGoodsReceiptSchema>;

/** Decision 29: who checked, when, the result, quantities (on the lines) and remarks. */
export const receiptCheckSchema = z.object({
  result: z.enum(CHECK_RESULTS),
  remarks: optionalText(500),
  checkedAt: z.string().datetime({ offset: true }).optional(),
});
export type ReceiptCheckInput = z.infer<typeof receiptCheckSchema>;

export const purchaseReturnSchema = z.object({
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  reason: trimmed(300),
  lines: z
    .array(
      z.object({
        originalLineId: uuid,
        /** Quantities going back, in the original line's unit (positive numbers). */
        acceptedQuantity: nonNegativeDecimalString.optional().nullable(),
        rejectedQuantity: nonNegativeDecimalString.optional().nullable(),
        serialNumbers: z.array(trimmed(60)).optional(),
      }),
    )
    .min(1, 'Choose at least one line to return'),
});
export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>;

export const goodsReceiptQuerySchema = z.object({
  status: z.enum(RECEIPT_STATUSES).optional(),
  supplierId: uuid.optional(),
  storeId: uuid.optional(),
  isReturn: z.enum(['true', 'false']).optional(),
  isConsignment: z.enum(['true', 'false']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type GoodsReceiptQuery = z.infer<typeof goodsReceiptQuerySchema>;

// ---- Supplier bills ----

export const supplierBillLineSchema = z.object({
  receiptLineId: uuid.optional().nullable(),
  orderLineId: uuid.optional().nullable(),
  itemId: uuid,
  unitId: uuid.optional(),
  quantity: positiveDecimalString,
  freeQuantity: nonNegativeDecimalString.optional().nullable(),
  ...priceFields,
  ...gstFields,
  /** Bills that receive goods: where they go, batch and serials. */
  shelfLocationId: uuid.optional().nullable(),
  ...batchFields,
  serialNumbers: z.array(trimmed(60)).optional(),
  /** Plan 08 G8: false = input credit cannot be claimed; the tax is added to the cost of the goods. */
  creditClaimable: z.boolean().optional(),
});
export type SupplierBillLineInput = z.infer<typeof supplierBillLineSchema>;

export const createSupplierBillSchema = z.object({
  kind: z.enum(['against_receipt', 'receives_goods', 'services']),
  supplierId: uuid,
  supplierBillNo: trimmed(40),
  supplierBillDate: isoDate,
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  /** Bills that receive goods: the store they arrive at. */
  storeId: uuid.optional().nullable(),
  paymentTermsId: uuid.optional().nullable(),
  remarks: optionalText(500),
  /** Plan 08 G8: the shop pays the tax itself (empty = from the supplier's tax situation). */
  reverseCharge: z.boolean().optional().nullable(),
  lines: z.array(supplierBillLineSchema).min(1, 'Add at least one line'),
});
export type CreateSupplierBillInput = z.infer<typeof createSupplierBillSchema>;

export const updateSupplierBillSchema = createSupplierBillSchema.omit({ kind: true }).partial();
export type UpdateSupplierBillInput = z.infer<typeof updateSupplierBillSchema>;

export const finaliseBillSchema = z.object({
  /** Plan 05 answer 4: the Accountant confirms a price different from the receipt. */
  confirmPriceDifference: z.boolean().optional(),
});
export type FinaliseBillInput = z.infer<typeof finaliseBillSchema>;

export const holdBillSchema = z.object({ reason: trimmed(300), until: isoDate });
export type HoldBillInput = z.infer<typeof holdBillSchema>;

export const debitNoteSchema = z.object({
  postingDate: isoDate.optional(),
  supplierNoteNo: optionalText(40),
  reason: trimmed(300),
  lines: z.array(z.object({ originalLineId: uuid, quantity: positiveDecimalString })).min(1, 'Choose at least one line'),
});
export type DebitNoteInput = z.infer<typeof debitNoteSchema>;

export const supplierBillQuerySchema = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  kind: z.enum(BILL_KINDS).optional(),
  supplierId: uuid.optional(),
  held: z.enum(['true', 'false']).optional(),
  dueBy: isoDate.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type SupplierBillQuery = z.infer<typeof supplierBillQuerySchema>;

// ---- Extra charges (landed cost) ----

export const landedChargeSchema = z.object({
  postingDate: isoDate.optional(),
  shareBy: z.enum(SHARE_BY),
  receiptIds: z.array(uuid).min(1, 'Choose at least one goods receipt'),
  charges: z
    .array(z.object({ description: trimmed(120), chargeType: z.enum(CHARGE_TYPES), amount: positiveDecimalString }))
    .min(1, 'Add at least one charge'),
  /** Only with shareBy = manual: the amount for each received line. */
  manualShares: z.array(z.object({ receiptLineId: uuid, amount: nonNegativeDecimalString })).optional(),
  transporterBillId: uuid.optional().nullable(),
  remarks: optionalText(500),
});
export type LandedChargeInput = z.infer<typeof landedChargeSchema>;

// ---- Reorder suggestions and settings ----

export const createOrdersFromSuggestionsSchema = z.object({
  suggestionIds: z.array(uuid).min(1, 'Tick at least one suggestion'),
  neededBy: isoDate.optional(),
});
export type CreateOrdersFromSuggestionsInput = z.infer<typeof createOrdersFromSuggestionsSchema>;

export const purchaseSettingsSchema = z
  .object({
    requireOrderForReceipt: z.boolean(),
    billNeedsOrder: z.boolean(),
    billNeedsReceipt: z.boolean(),
    overOrderPercent: percent,
    overReceiptPercent: percent,
    overBillingPercent: percent,
    priceMismatch: z.enum(PRICE_MISMATCH),
    checkSupplierBillNo: z.boolean(),
    approvalLimit: nonNegativeDecimalString,
    fillLastPurchasePrice: z.boolean(),
  })
  .partial();
export type PurchaseSettingsInput = z.infer<typeof purchaseSettingsSchema>;

export const purchaseReportQuerySchema = z.object({
  supplierId: uuid.optional(),
  storeId: uuid.optional(),
  itemId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type PurchaseReportQuery = z.infer<typeof purchaseReportQuerySchema>;

/** A plain decimal-string check for amounts typed in the web forms. */
export const purchaseAmount = decimalString;

// ---- Supplier sale-or-return (plan 11 part 2 §3) ----

export const CONSIGNMENT_STATEMENT_STATUSES = ['draft', 'billed', 'cancelled'] as const;
export type ConsignmentStatementStatus = (typeof CONSIGNMENT_STATEMENT_STATUSES)[number];

/** A statement for one supplier and store; the period starts after the last billed statement unless given. */
export const createConsignmentStatementSchema = z
  .object({
    supplierId: uuid,
    storeId: uuid,
    fromDate: isoDate.optional(),
    toDate: isoDate,
    remarks: optionalText(500),
  })
  .refine((s) => !s.fromDate || s.fromDate <= s.toDate, { message: 'The start date is after the end date', path: ['fromDate'] });
export type CreateConsignmentStatementInput = z.infer<typeof createConsignmentStatementSchema>;

export const consignmentStatementQuerySchema = z.object({
  supplierId: uuid.optional(),
  storeId: uuid.optional(),
  status: z.enum(CONSIGNMENT_STATEMENT_STATUSES).optional(),
});
export type ConsignmentStatementQuery = z.infer<typeof consignmentStatementQuerySchema>;

/** Turning a statement into the supplier's bill for the sold quantity. */
export const consignmentBillSchema = z.object({
  /** The supplier's own invoice number; the statement number when left out. */
  supplierBillNo: z.string().trim().max(60).optional().nullable(),
  supplierBillDate: isoDate.optional(),
  postingDate: isoDate.optional(),
});
export type ConsignmentBillInput = z.infer<typeof consignmentBillSchema>;

export const consignmentStockQuerySchema = z.object({
  supplierId: uuid.optional(),
  storeId: uuid.optional(),
});
export type ConsignmentStockQuery = z.infer<typeof consignmentStockQuerySchema>;
