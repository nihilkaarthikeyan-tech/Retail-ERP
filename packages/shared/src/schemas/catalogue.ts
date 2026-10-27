// Copyright (c) 2026, Rademics. All rights reserved.
// Module 2 input validation: units, groups, brands, HSN, attributes, items,
// barcodes, variants, price lists and prices.
import { z } from 'zod';
import { BARCODE_TYPES } from '../barcodes.js';
import { isIsoDate } from '../financial-year.js';
import { UNIT_KINDS } from '../units.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');

/** Money and quantities travel as decimal strings, never floats (rule 1). */
export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a number such as 12.50');
export const positiveDecimalString = decimalString.refine((v) => Number(v) > 0, 'Must be above zero');
export const nonNegativeDecimalString = decimalString.refine((v) => Number(v) >= 0, 'Must be zero or more');

export const unitCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, 'Unit code must be 1–10 letters or digits');

export const itemCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9\-./]{0,39}$/, 'Code may contain letters, digits, - . and /');

export const hsnCode = z.string().trim().regex(/^\d{4}(\d{2})?(\d{2})?$/, 'HSN/SAC must be 4, 6 or 8 digits');

// ---- Units ----

export const createUnitSchema = z.object({
  code: unitCode,
  name: trimmed(40),
  kind: z.enum(UNIT_KINDS),
  allowsFractions: z.boolean().optional(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = z.object({ name: trimmed(40), allowsFractions: z.boolean(), active: z.boolean() }).partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const createUnitConversionSchema = z.object({
  fromUnitId: z.string().uuid(),
  toUnitId: z.string().uuid(),
  factor: positiveDecimalString,
});
export type CreateUnitConversionInput = z.infer<typeof createUnitConversionSchema>;

// ---- Groups, brands, HSN ----

export const createItemGroupSchema = z.object({
  code: itemCode,
  name: trimmed(80),
  parentId: z.string().uuid().optional().nullable(),
  hsnCode: hsnCode.optional().nullable(),
});
export type CreateItemGroupInput = z.infer<typeof createItemGroupSchema>;

export const updateItemGroupSchema = z
  .object({ name: trimmed(80), hsnCode: hsnCode.nullable(), active: z.boolean() })
  .partial();
export type UpdateItemGroupInput = z.infer<typeof updateItemGroupSchema>;

export const createBrandSchema = z.object({ code: itemCode, name: trimmed(80) });
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export const updateBrandSchema = z.object({ name: trimmed(80), active: z.boolean() }).partial();
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

export const createHsnCodeSchema = z.object({
  code: hsnCode,
  description: trimmed(200),
  isService: z.boolean().optional(),
});
export type CreateHsnCodeInput = z.infer<typeof createHsnCodeSchema>;
export const updateHsnCodeSchema = z.object({ description: trimmed(200), active: z.boolean() }).partial();
export type UpdateHsnCodeInput = z.infer<typeof updateHsnCodeSchema>;

// ---- Variant attributes ----

const attributeValue = z.object({
  value: trimmed(40),
  shortCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.]{1,10}$/, 'Short code must be 1–10 letters, digits or dots'),
});

export const createAttributeSchema = z
  .object({
    code: itemCode,
    name: trimmed(40),
    kind: z.enum(['list', 'numeric']),
    values: z.array(attributeValue).optional(),
    rangeStart: z.number().optional().nullable(),
    rangeEnd: z.number().optional().nullable(),
    rangeStep: z.number().optional().nullable(),
  })
  .refine((a) => (a.kind === 'list' ? (a.values?.length ?? 0) > 0 : a.rangeStart != null && a.rangeEnd != null && a.rangeStep != null), {
    message: 'A list attribute needs values; a numeric one needs start, end and step',
  });
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;

export const updateAttributeSchema = z
  .object({
    name: trimmed(40),
    active: z.boolean(),
    /** Replaces the value list; values in use by variants must stay (checked by the API). */
    values: z.array(attributeValue),
  })
  .partial();
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;

// ---- Items ----

const itemUnit = z.object({
  unitId: z.string().uuid(),
  factor: positiveDecimalString,
  mrp: nonNegativeDecimalString.optional().nullable(),
});

export const itemBodySchema = z.object({
  code: itemCode.optional(),
  name: trimmed(120),
  description: optionalText(1000),
  itemGroupId: z.string().uuid(),
  brandId: z.string().uuid().optional().nullable(),
  baseUnitId: z.string().uuid(),
  hsnCode: hsnCode.optional().nullable(),
  mrp: nonNegativeDecimalString.optional().nullable(),
  maxDiscountPercent: decimalString
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Discount must be between 0 and 100')
    .optional(),
  isStockItem: z.boolean().optional(),
  canBuy: z.boolean().optional(),
  canSell: z.boolean().optional(),
  endDate: isoDate.optional().nullable(),
  trackBatches: z.boolean().optional(),
  autoNumberBatches: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(0).optional().nullable(),
  trackSerials: z.boolean().optional(),
  warrantyDays: z.number().int().min(0).optional().nullable(),
  /** Plan 11 C4: the season or collection. */
  seasonId: z.string().uuid().optional().nullable(),
  /** Creates a style that varies by these attributes (no stock or prices on it). */
  variantAttributeIds: z.array(z.string().uuid()).optional(),
});

export const createItemSchema = itemBodySchema.extend({
  /** Extra units with their pack factors; the basic unit is added automatically. */
  units: z.array(itemUnit).optional(),
  /** First selling price in the default selling list (per basic unit). */
  sellingPrice: nonNegativeDecimalString.optional().nullable(),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = itemBodySchema
  .omit({ code: true, variantAttributeIds: true })
  .extend({
    active: z.boolean(),
    /** Plan 11 B2: on a style, also copy the changed style fields to all its sizes and colours. */
    applyToVariants: z.boolean(),
  })
  .partial();
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const setItemUnitsSchema = z.object({ units: z.array(itemUnit) });
export type SetItemUnitsInput = z.infer<typeof setItemUnitsSchema>;

export const createBarcodeSchema = z.object({
  code: z.string().trim().min(1).max(64),
  type: z.enum(BARCODE_TYPES).optional(),
  unitId: z.string().uuid().optional().nullable(),
});
export type CreateBarcodeInput = z.infer<typeof createBarcodeSchema>;

export const updateBarcodeSchema = z.object({ unitId: z.string().uuid().nullable(), active: z.boolean() }).partial();
export type UpdateBarcodeInput = z.infer<typeof updateBarcodeSchema>;

export const createVariantsSchema = z.object({
  /** attributeId → values to tick (list attributes) or numbers as strings (numeric ones). */
  values: z.record(z.string().uuid(), z.array(trimmed(40)).min(1)),
});
export type CreateVariantsInput = z.infer<typeof createVariantsSchema>;

export const itemQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  groupId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  kind: z.enum(['stock', 'service', 'style']).optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

/** Plan 11 B2: the style fields "also change all its sizes and colours" copies (never codes, barcodes or prices). */
export const STYLE_FIELDS_FOR_VARIANTS = ['mrp', 'hsnCode', 'brandId', 'itemGroupId', 'maxDiscountPercent', 'description', 'seasonId'] as const;

// ---- Seasons (plan 11 C4) ----

export const createSeasonSchema = z
  .object({
    code: itemCode,
    name: trimmed(80),
    startsOn: isoDate.optional().nullable(),
    endsOn: isoDate.optional().nullable(),
  })
  .refine((s) => !s.startsOn || !s.endsOn || s.endsOn >= s.startsOn, { message: 'The season cannot end before it starts' });
export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;

export const updateSeasonSchema = z
  .object({ name: trimmed(80), startsOn: isoDate.nullable(), endsOn: isoDate.nullable(), active: z.boolean() })
  .partial()
  .refine((s) => !s.startsOn || !s.endsOn || s.endsOn >= s.startsOn, { message: 'The season cannot end before it starts' });
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;

// ---- Markdowns (plan 11 C5) ----

export const MARKDOWN_RULES = ['percent', 'price'] as const;
export type MarkdownRule = (typeof MARKDOWN_RULES)[number];

export const markdownSchema = z
  .object({
    /** Empty = the default selling list. */
    priceListId: z.string().uuid().optional().nullable(),
    seasonId: z.string().uuid().optional().nullable(),
    itemGroupIds: z.array(z.string().uuid()).max(200).optional(),
    brandIds: z.array(z.string().uuid()).max(200).optional(),
    /** Chosen items; a style stands for all its sizes and colours. */
    itemIds: z.array(z.string().uuid()).max(2000).optional(),
    rule: z.enum(MARKDOWN_RULES),
    /** Percent off (rule "percent") or the new price per basic unit (rule "price"). */
    value: positiveDecimalString,
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    remark: optionalText(200),
  })
  .refine((m) => !!m.seasonId || !!m.itemGroupIds?.length || !!m.brandIds?.length || !!m.itemIds?.length, { message: 'Choose a season, groups, brands or items' })
  .refine((m) => m.rule !== 'percent' || Number(m.value) < 100, { message: 'The percentage off must be below 100' })
  .refine((m) => !m.endDate || m.endDate >= m.startDate, { message: 'End date cannot be before start date' });
export type MarkdownInput = z.infer<typeof markdownSchema>;

// ---- Price lists and prices ----

export const createPriceListSchema = z
  .object({
    code: itemCode,
    name: trimmed(80),
    forSelling: z.boolean(),
    forBuying: z.boolean(),
    pricesPerUnit: z.boolean().optional(),
  })
  .refine((p) => p.forSelling || p.forBuying, { message: 'A price list must be for selling, buying or both' });
export type CreatePriceListInput = z.infer<typeof createPriceListSchema>;

export const updatePriceListSchema = z.object({ name: trimmed(80), pricesPerUnit: z.boolean(), active: z.boolean() }).partial();
export type UpdatePriceListInput = z.infer<typeof updatePriceListSchema>;

export const createPriceSchema = z
  .object({
    priceListId: z.string().uuid(),
    itemId: z.string().uuid(),
    unitId: z.string().uuid().optional().nullable(),
    price: nonNegativeDecimalString,
    startDate: isoDate.optional(),
    endDate: isoDate.optional().nullable(),
    packSize: positiveDecimalString.optional().nullable(),
    customerId: z.string().uuid().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
  })
  .refine((p) => !p.endDate || !p.startDate || p.endDate >= p.startDate, { message: 'End date cannot be before start date' })
  .refine((p) => !(p.customerId && p.supplierId), { message: 'A price is for a customer or a supplier, not both' });
export type CreatePriceInput = z.infer<typeof createPriceSchema>;

/**
 * One price for every size and colour of a style (found in the launch check of 27 October
 * 2026: a style's 30 variants had to be priced one by one). Each variant still gets its own
 * price (blueprint 04: prices are on variants, not on the style); variants that already have
 * a price in the list on that date are left as they are.
 */
export const stylePriceSchema = z.object({
  styleId: z.string().uuid(),
  priceListId: z.string().uuid(),
  price: nonNegativeDecimalString,
  startDate: isoDate.optional(),
});
export type StylePriceInput = z.infer<typeof stylePriceSchema>;

export const updatePriceSchema = z.object({ price: nonNegativeDecimalString, endDate: isoDate.nullable() }).partial();
export type UpdatePriceInput = z.infer<typeof updatePriceSchema>;

export const priceQuerySchema = z.object({
  priceListId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  date: isoDate.optional(),
  includeEnded: z.enum(['true', 'false']).optional(),
});
export type PriceQuery = z.infer<typeof priceQuerySchema>;

export const priceLookupSchema = z.object({
  itemId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  priceListId: z.string().uuid().optional(),
  date: isoDate.optional(),
  quantity: positiveDecimalString.optional(),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
});
export type PriceLookupInput = z.infer<typeof priceLookupSchema>;

export const updateCatalogueSettingsSchema = z
  .object({
    autoItemCodes: z.boolean(),
    defaultItemGroupId: z.string().uuid().nullable(),
    defaultUnitId: z.string().uuid().nullable(),
    defaultSellingPriceListId: z.string().uuid().nullable(),
    defaultBuyingPriceListId: z.string().uuid().nullable(),
    fallbackToDefaultSellingList: z.boolean(),
    allowPriceChangeOnBill: z.boolean(),
    blockSellingBelowCost: z.boolean(),
    saveTypedPrices: z.boolean(),
  })
  .partial();
export type UpdateCatalogueSettingsInput = z.infer<typeof updateCatalogueSettingsSchema>;
