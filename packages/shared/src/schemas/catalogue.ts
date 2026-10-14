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

export const updateItemSchema = itemBodySchema.omit({ code: true, variantAttributeIds: true }).extend({ active: z.boolean() }).partial();
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
  kind: z.enum(['stock', 'service', 'style']).optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

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
