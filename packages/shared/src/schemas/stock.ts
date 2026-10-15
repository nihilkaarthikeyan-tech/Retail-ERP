// Copyright (c) 2026, Rademics. All rights reserved.
// Module 4 input validation: locations, stock documents, counts, reorder levels.
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';
import { itemCode, nonNegativeDecimalString, positiveDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

export const LOCATION_KINDS = ['folder', 'shelf', 'transit', 'rejected'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Kinds of stock document a user can create (counts have their own form). */
export const STOCK_DOC_KINDS = ['stock_in', 'stock_out', 'move', 'transfer_send'] as const;
export type StockDocKind = (typeof STOCK_DOC_KINDS)[number] | 'transfer_receive' | 'count';

export const STOCK_IN_REASONS = ['opening', 'found', 'free_goods', 'other_in'] as const;
export const STOCK_OUT_REASONS = ['damage', 'expiry', 'theft_loss', 'sample', 'shop_use', 'other_out'] as const;
export const COUNT_TYPES = ['opening', 'normal'] as const;

/** Which account role the stock value is posted against (module 7 posts it). */
export const ACCOUNT_ROLE_BY_REASON: Record<string, string> = {
  opening: 'temporary_opening',
  found: 'stock_adjustment',
  free_goods: 'stock_adjustment',
  other_in: 'stock_adjustment',
  damage: 'write_off',
  expiry: 'write_off',
  theft_loss: 'write_off',
  sample: 'samples_expense',
  shop_use: 'shop_use_expense',
  other_out: 'stock_adjustment',
};

export const createLocationSchema = z.object({
  storeId: z.string().uuid(),
  parentId: z.string().uuid().optional().nullable(),
  code: itemCode,
  name: trimmed(60),
  kind: z.enum(['folder', 'shelf', 'rejected']),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export const updateLocationSchema = z.object({ name: trimmed(60), active: z.boolean() }).partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const stockLineSchema = z.object({
  itemId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  quantity: positiveDecimalString,
  /** Existing batch (out, move, transfer, or receiving more of a known batch). */
  batchId: z.string().uuid().optional().nullable(),
  /** New batch on a stock-in: number (or blank for automatic numbering), dates. */
  batchNumber: z.string().trim().max(40).optional().nullable(),
  manufactureDate: isoDate.optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
  serialNumbers: z.array(z.string().trim().min(1).max(60)).optional(),
  /** Cost per line unit (e.g. per box when the line is in boxes); required on stock-in. Stored per basic unit. */
  unitCost: nonNegativeDecimalString.optional().nullable(),
});
export type StockLineInput = z.infer<typeof stockLineSchema>;

export const createStockDocumentSchema = z.object({
  kind: z.enum(STOCK_DOC_KINDS),
  reason: z.enum([...STOCK_IN_REASONS, ...STOCK_OUT_REASONS]).optional().nullable(),
  storeId: z.string().uuid(),
  fromLocationId: z.string().uuid().optional().nullable(),
  toLocationId: z.string().uuid().optional().nullable(),
  /** Transfers: the receiving store. */
  toStoreId: z.string().uuid().optional().nullable(),
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  remarks: optionalText(300),
  lines: z.array(stockLineSchema).min(1).max(500),
});
export type CreateStockDocumentInput = z.infer<typeof createStockDocumentSchema>;

export const updateStockDocumentSchema = createStockDocumentSchema.omit({ kind: true, storeId: true }).partial();
export type UpdateStockDocumentInput = z.infer<typeof updateStockDocumentSchema>;

export const receiveTransferSchema = z.object({
  toLocationId: z.string().uuid().optional(),
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  remarks: optionalText(300),
  /** Omit to receive everything still in transit. */
  lines: z
    .array(
      z.object({
        sendLineId: z.string().uuid(),
        quantity: positiveDecimalString,
        serialNumbers: z.array(z.string().trim().min(1).max(60)).optional(),
      }),
    )
    .optional(),
});
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const countLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
  batchNumber: z.string().trim().max(40).optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
  countedQuantity: nonNegativeDecimalString,
  /** New cost per basic unit (opening stock, or a cost correction). */
  unitCost: nonNegativeDecimalString.optional().nullable(),
  serialNumbers: z.array(z.string().trim().min(1).max(60)).optional(),
});
export type CountLineInput = z.infer<typeof countLineSchema>;

export const createCountSchema = z.object({
  countType: z.enum(COUNT_TYPES),
  storeId: z.string().uuid(),
  locationId: z.string().uuid(),
  blind: z.boolean().optional(),
  postingDate: isoDate.optional(),
  postingTime: hhmm.optional(),
  remarks: optionalText(300),
  lines: z.array(countLineSchema).min(1).max(2000),
});
export type CreateCountInput = z.infer<typeof createCountSchema>;
export const updateCountSchema = createCountSchema.omit({ countType: true, storeId: true }).partial();
export type UpdateCountInput = z.infer<typeof updateCountSchema>;

export const cancelStockDocumentSchema = z.object({ reason: trimmed(200) });
export type CancelStockDocumentInput = z.infer<typeof cancelStockDocumentSchema>;

export const stockDocumentQuerySchema = z.object({
  kind: z.enum(['stock_in', 'stock_out', 'move', 'transfer_send', 'transfer_receive', 'count']).optional(),
  status: z.enum(['draft', 'finalised', 'cancelled']).optional(),
  storeId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type StockDocumentQuery = z.infer<typeof stockDocumentQuerySchema>;

export const stockBalanceQuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  asOf: isoDate.optional(),
  includeZero: z.enum(['true', 'false']).optional(),
});
export type StockBalanceQuery = z.infer<typeof stockBalanceQuerySchema>;

export const stockLedgerQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type StockLedgerQuery = z.infer<typeof stockLedgerQuerySchema>;

export const reorderLevelSchema = z.object({
  itemId: z.string().uuid(),
  storeId: z.string().uuid(),
  level: nonNegativeDecimalString,
  quantity: positiveDecimalString,
  requestType: z.enum(['buy', 'move']).optional(),
  active: z.boolean().optional(),
});
export type ReorderLevelInput = z.infer<typeof reorderLevelSchema>;

export const updateInventorySettingsSchema = z
  .object({
    stockLockDate: isoDate.nullable(),
    allowNegativeAtTill: z.boolean(),
    batchPickOrder: z.enum(['earliest_expiry', 'oldest_first']),
  })
  .partial();
export type UpdateInventorySettingsInput = z.infer<typeof updateInventorySettingsSchema>;
