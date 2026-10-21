// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 input validation: the loyalty scheme and its tiers, gift cards sold
// and reloaded at the till, blocking a card, and the lists and reports.
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';
import { GIFT_CARD_MAX_LOAD, isValidGiftCardNumber, LOYALTY_EXPIRY_TO, normaliseGiftCardNumber } from '../loyalty.js';
import { nonNegativeDecimalString, positiveDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const uuid = z.string().uuid();
const percent = positiveDecimalString.refine((v) => Number(v) <= 100, 'Must be 100 or less');
const money = positiveDecimalString.refine((v) => !v.includes('.') || v.split('.')[1].length <= 2, 'At most 2 decimal places (paise)');
/** A point's value in rupees and paise (e.g. 0.25), so points × value is always exact. */
const pointValue = money;

/** A gift card number typed or scanned: spaces and dashes are dropped; the check digit must be right. */
export const giftCardNumberSchema = z
  .string()
  .trim()
  .transform(normaliseGiftCardNumber)
  .refine(isValidGiftCardNumber, 'That gift card number is not right; check the digits');

// ---- Loyalty scheme (PATCH: any of the fields) ----

export const loyaltySettingsSchema = z
  .object({
    schemeName: trimmed(60),
    earnSpend: money,
    earnPoints: z.number().int().min(1).max(1000),
    pointValue,
    validityDays: z.number().int().min(1).max(3650),
    minRedeem: z.number().int().min(1).max(1_000_000),
    maxSharePercent: percent,
    joinAll: z.boolean(),
    customerGroupIds: z.array(uuid).max(200),
    expiryTo: z.enum(LOYALTY_EXPIRY_TO),
  })
  .partial();
export type LoyaltySettingsInput = z.infer<typeof loyaltySettingsSchema>;

export const loyaltyTierSchema = z.object({
  name: trimmed(40),
  spendFrom: nonNegativeDecimalString,
  earnSpend: money,
  earnPoints: z.number().int().min(1).max(1000),
  sortOrder: z.number().int().min(0).max(100).optional(),
});
export type LoyaltyTierInput = z.infer<typeof loyaltyTierSchema>;

export const loyaltyReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  storeId: uuid.optional(),
});
export type LoyaltyReportQuery = z.infer<typeof loyaltyReportQuerySchema>;

/** Running the nightly expiry by hand (the Owner): for today only. */
export const expiryRunSchema = z.object({ confirm: z.literal(true) });

// ---- Gift cards ----

/** Selling a new card (no number) or loading more onto one (its number), at the till. Needs the connection. */
export const giftCardSaleSchema = z.object({
  /** Idempotency key (pos-offline §4): the same sale sent twice is saved once. */
  clientId: uuid,
  tillId: uuid,
  /** A reload: the card's number. Empty: a new card with a new number. */
  number: giftCardNumberSchema.optional().nullable(),
  amount: money.refine((v) => Number(v) <= Number(GIFT_CARD_MAX_LOAD), `At most ₹${GIFT_CARD_MAX_LOAD} at a time`),
  paymentMethodId: uuid,
  reference: optionalText(60),
  holderName: optionalText(120),
  holderPhone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, 'Phone number must be 10 digits')
    .optional()
    .nullable(),
  customerId: uuid.optional().nullable(),
});
export type GiftCardSaleInput = z.infer<typeof giftCardSaleSchema>;

export const giftCardBlockSchema = z.object({ reason: trimmed(200) });
export type GiftCardBlockInput = z.infer<typeof giftCardBlockSchema>;

export const GIFT_CARD_STATUSES = ['active', 'blocked', 'expired'] as const;

export const giftCardQuerySchema = z.object({
  search: z.string().trim().max(40).optional(),
  status: z.enum(GIFT_CARD_STATUSES).optional(),
  storeId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type GiftCardQuery = z.infer<typeof giftCardQuerySchema>;

export const giftCardLookupSchema = z.object({ number: giftCardNumberSchema });
export type GiftCardLookupInput = z.infer<typeof giftCardLookupSchema>;
