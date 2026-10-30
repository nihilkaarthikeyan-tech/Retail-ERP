// Copyright (c) 2026, Rademics. All rights reserved.
// Module 10 input validation (plan 10): printing, labels, imports, exports and going live.
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';

const isoDate = z.string().refine(isIsoDate, 'Choose a date');
const uuid = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);

// ---- Printing ----

export const PRINT_KINDS = ['purchase_order', 'goods_receipt', 'transfer', 'count_sheet', 'payment', 'journal', 'statement', 'customer_order', 'alteration_job', 'alteration_tag', 'pos_bill', 'rcm_self_invoice'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export const printSettingsSchema = z.object({
  paperSize: z.enum(['A4', 'A5']),
  showLogo: z.boolean(),
  /** Each store's own address and GSTIN at the top (decision 75); off = the company's. */
  storeLetterhead: z.boolean(),
});
export type PrintSettingsInput = z.infer<typeof printSettingsSchema>;

export const TERMS_USE = ['selling', 'buying', 'both'] as const;
export const standardTermsSchema = z.object({
  title: trimmed(80),
  text: trimmed(2000),
  usedFor: z.enum(TERMS_USE),
  /** Print kinds that take it by default. */
  defaultFor: z.array(z.enum(PRINT_KINDS)).default([]),
  active: z.boolean().default(true),
});
export type StandardTermsInput = z.infer<typeof standardTermsSchema>;

// ---- Labels (decision 73: standard templates with basic editing) ----

export const LABEL_FIELDS = ['name', 'price', 'mrp', 'barcode', 'code', 'unit', 'batch', 'expiry', 'packed', 'store'] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

export const labelTemplateSchema = z.object({
  name: trimmed(60),
  /** A size from LABEL_SIZES, or "custom" with the sizes below. */
  sizeKey: z.string().trim().min(1).max(30),
  width: z.coerce.number().min(15).max(120).optional(),
  height: z.coerce.number().min(10).max(120).optional(),
  media: z.enum(['sheet', 'roll']).optional(),
  fields: z.array(z.enum(LABEL_FIELDS)).min(1, 'Choose at least one thing to print'),
  /** Text size in points for the item name; the rest scales from it. */
  fontSize: z.coerce.number().min(5).max(16).default(8),
  isDefault: z.boolean().default(false),
});
export type LabelTemplateInput = z.infer<typeof labelTemplateSchema>;

export const labelRequestSchema = z
  .object({
    templateId: uuid.optional(),
    storeId: uuid.optional(),
    priceListId: uuid.optional(),
    /** Chosen items with copies. */
    items: z.array(z.object({ itemId: uuid, copies: z.coerce.number().int().min(1).max(500), unitId: uuid.optional() })).max(500).optional(),
    /** Every unit on a goods receipt. */
    receiptId: uuid.optional(),
    /** Items whose selling price changed on or after this date. */
    priceChangedSince: isoDate.optional(),
    /** Plan 11 C5: the items of a markdown, each label showing the old and the new price. */
    markdownId: uuid.optional(),
  })
  .refine(
    (r) => [r.items?.length ? 1 : 0, r.receiptId ? 1 : 0, r.priceChangedSince ? 1 : 0, r.markdownId ? 1 : 0].reduce((a, b) => a + b, 0) === 1,
    'Choose items, a goods receipt, a price-change date or a markdown',
  );
export type LabelRequest = z.infer<typeof labelRequestSchema>;

// ---- Import and export (decisions 77, 78) ----

export const IMPORT_KINDS = {
  item_groups: 'Item groups',
  brands: 'Brands',
  items: 'Items',
  styles_variants: 'Styles and variants',
  prices: 'Prices',
  customers: 'Customers',
  suppliers: 'Suppliers',
  reorder_levels: 'Reorder levels',
  opening_stock: 'Opening stock',
  opening_bills: 'Unpaid bills from before going live',
} as const;
export type ImportKind = keyof typeof IMPORT_KINDS;
export const IMPORT_MODES = ['add', 'change', 'add_or_change'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const importOptionsSchema = z.object({
  kind: z.string().refine((k) => k in IMPORT_KINDS, 'Unknown kind of import'),
  mode: z.enum(IMPORT_MODES).default('add'),
  /** File column → field, when the automatic matching needs correcting; "" skips a column. */
  mapping: z.record(z.string(), z.string()).optional(),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const EXPORT_KINDS = ['items', 'prices', 'customers', 'suppliers', 'reorder_levels'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

// ---- Going live (decision 72) ----

export const clearTrialDataSchema = z.object({
  /** The company's legal name, typed in full, to confirm. */
  confirmCompanyName: trimmed(200),
  reason: trimmed(300),
});
export type ClearTrialDataInput = z.infer<typeof clearTrialDataSchema>;

export const goLiveDateSchema = z.object({ goLiveDate: isoDate, confirmCompanyName: trimmed(200) });
export type GoLiveDateInput = z.infer<typeof goLiveDateSchema>;
