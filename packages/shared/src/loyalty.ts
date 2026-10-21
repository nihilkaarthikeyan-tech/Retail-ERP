// Copyright (c) 2026, Rademics. All rights reserved.
// Loyalty points and reloadable gift cards (plan 13; blueprint 04 processes 6
// and 7 and the loyalty rules; decisions 14, 15 and 16). Pure functions on
// decimal strings, shared by the API (authoritative) and the till (preview and
// offline receipts). Points are whole numbers; money is never a float (rule 1)
// and is rounded only through rounding.ts (rule 2).
import { addDays } from './financial-year.js';
import { Decimal, type DecimalInput, roundMoney, roundTo } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Settings and their starting values (approved by the owner, 21 October 2026)

/** Where expired points are written back: the loyalty expense they came from, or other income. */
export const LOYALTY_EXPIRY_TO = ['loyalty_expense', 'other_income'] as const;
export type LoyaltyExpiryTo = (typeof LOYALTY_EXPIRY_TO)[number];

export const LOYALTY_DEFAULTS = {
  schemeName: 'Loyalty points',
  /** ₹100 spent earns … */
  earnSpend: '100',
  /** … 1 point. */
  earnPoints: 1,
  /** 1 point = ₹1 when spent. */
  pointValue: '1',
  validityDays: 365,
  minRedeem: 100,
  maxSharePercent: '50',
  joinAll: true,
  customerGroupIds: [] as string[],
  expiryTo: 'loyalty_expense' as LoyaltyExpiryTo,
} as const;

/** Plan 13 §2: a gift card lasts 12 months from issue (fixed for now; a setting needs a new column). */
export const GIFT_CARD_VALIDITY_MONTHS = 12;
/** The most one card may be loaded with in one go (a typing-mistake guard, not a legal limit). */
export const GIFT_CARD_MAX_LOAD = '200000';

/** An earn rate: `earnPoints` points for every `earnSpend` rupees that earn. */
export interface EarnRate {
  earnSpend: DecimalInput;
  earnPoints: number;
}

/** An optional tier: from this yearly spend, earn at its own rate. */
export interface TierRow extends EarnRate {
  id?: string;
  name: string;
  spendFrom: DecimalInput;
}

// ---------------------------------------------------------------------------
// Earning (blueprint 04 process 6)

/**
 * Amount that earns = bill total − paid with points − paid with gift cards
 * (plan 13 §1). Never below zero; a walk-in bill earns nothing (checked by the caller).
 */
export function earningAmount(args: { total: DecimalInput; paidWithPoints?: DecimalInput; paidWithGiftCards?: DecimalInput }): Decimal {
  const a = D(args.total).sub(D(args.paidWithPoints ?? 0)).sub(D(args.paidWithGiftCards ?? 0));
  return a.gt(0) ? a : ZERO;
}

/** Points earned = whole number of (amount × points ÷ rupees); fractions are dropped (blueprint 04 rules). */
export function pointsFor(amount: DecimalInput, rate: EarnRate): number {
  const a = D(amount);
  const spend = D(rate.earnSpend);
  if (a.lte(0) || spend.lte(0) || rate.earnPoints <= 0) return 0;
  return a.mul(rate.earnPoints).div(spend).floor().toNumber();
}

/** Points value = points × value per point, in rupees and paise. */
export function pointsValue(points: number, pointValue: DecimalInput): Decimal {
  return roundMoney(D(points).mul(D(pointValue)));
}

/** The tier a yearly spend reaches: the highest whose "spend from" is at or below it; null without tiers. */
export function tierFor<T extends TierRow>(tiers: readonly T[], spend: DecimalInput): T | null {
  const s = D(spend);
  let best: T | null = null;
  for (const t of tiers) {
    if (D(t.spendFrom).gt(s)) continue;
    if (!best || D(t.spendFrom).gt(D(best.spendFrom))) best = t;
  }
  return best;
}

/** What is wrong with a list of tiers, or null (blueprint 04: the lowest tier must start at zero spend). */
export function tiersProblem(tiers: readonly TierRow[]): string | null {
  if (!tiers.length) return null;
  const names = new Set<string>();
  const froms = new Set<string>();
  for (const t of tiers) {
    const key = t.name.trim().toLowerCase();
    if (names.has(key)) return `Two tiers are called ${t.name.trim()}`;
    names.add(key);
    const from = D(t.spendFrom).toFixed(2);
    if (froms.has(from)) return `Two tiers start at ₹${from}`;
    froms.add(from);
    if (D(t.earnSpend).lte(0) || t.earnPoints <= 0) return `${t.name.trim()}: give the rupees and the points it earns`;
  }
  if (!tiers.some((t) => D(t.spendFrom).isZero())) return 'The lowest tier must start at ₹0 spent';
  return null;
}

/**
 * The first day of the 12 months a tier is worked out on: spend from this day
 * up to and including `date` counts ("spent in a year", plan 13 §1).
 */
export function tierWindowStart(date: string): string {
  const y = Number(date.slice(0, 4)) - 1;
  const md = date.slice(5);
  // 29 February has no twin a year back; the window then starts on 1 March.
  const start = md === '02-29' ? `${y}-03-01` : `${y}-${md}`;
  return addDays(start, md === '02-29' ? 0 : 1);
}

/** The day earned points lapse: bill date + days points last. They cannot be spent on or after it (blueprint 04 edge cases). */
export function pointsExpireOn(date: string, validityDays: number): string {
  return addDays(date, validityDays);
}

/** Usable on `date`: points whose expiry day is still to come. */
export function isUsableOn(expiresOn: string | null, date: string): boolean {
  return !expiresOn || expiresOn > date;
}

// ---------------------------------------------------------------------------
// Spending (blueprint 04 process 7)

export interface RedeemLimits {
  /** Points the customer can spend on the bill date (unexpired). */
  available: number;
  minRedeem: number;
  maxSharePercent: DecimalInput;
  pointValue: DecimalInput;
  /** What is to be paid on the bill (its total, never below zero). */
  billAmount: DecimalInput;
}

/** The most points the bill can take: the balance, the maximum share and the bill itself; 0 below the minimum. */
export function maxRedeemable(l: RedeemLimits): number {
  const value = D(l.pointValue);
  if (value.lte(0)) return 0;
  const cap = roundMoney(D(l.billAmount).mul(D(l.maxSharePercent)).div(100));
  const byShare = cap.div(value).floor().toNumber();
  const most = Math.max(0, Math.min(l.available, byShare));
  return most >= l.minRedeem ? most : 0;
}

/** Why `points` cannot be spent on the bill, in plain words, or null. */
export function redeemProblem(points: number, l: RedeemLimits): string | null {
  if (!Number.isInteger(points) || points <= 0) return 'Enter the number of points as a whole number';
  if (points < l.minRedeem) return `At least ${l.minRedeem} points must be spent at a time`;
  const value = pointsValue(points, l.pointValue);
  const cap = roundMoney(D(l.billAmount).mul(D(l.maxSharePercent)).div(100));
  if (value.gt(cap)) return `At most ${D(l.maxSharePercent).toString()}% of the bill (₹${cap.toFixed(2)}) can be paid with points`;
  if (value.gt(D(l.billAmount))) return 'Points cannot pay more than the bill';
  if (points > l.available) return `Only ${l.available} points can be spent today`;
  return null;
}

/** An earned lot of points with what is still unspent. */
export interface PointLot {
  id: string;
  remaining: number;
  expiresOn: string | null;
  /** Earned on (or created at), to break ties between lots expiring the same day. */
  entryDate?: string;
}

/** Points taken from lots, earliest-expiring first (blueprint 04 process 7.4); null when there are not enough. */
export function drawFromLots(lots: readonly PointLot[], points: number, date: string): { id: string; take: number }[] | null {
  const usable = lots
    .filter((l) => l.remaining > 0 && isUsableOn(l.expiresOn, date))
    .slice()
    .sort((a, b) => (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || (a.entryDate ?? '').localeCompare(b.entryDate ?? '') || a.id.localeCompare(b.id));
  const out: { id: string; take: number }[] = [];
  let left = points;
  for (const l of usable) {
    if (left <= 0) break;
    const take = Math.min(left, l.remaining);
    out.push({ id: l.id, take });
    left -= take;
  }
  return left > 0 ? null : out;
}

// ---------------------------------------------------------------------------
// Returns (decision 16): earned points taken back and spent points given back, in proportion

/** How much of the original bill has gone back after this return: 0 to 1. */
export function returnRatio(args: { originalTotal: DecimalInput; returnedTotal: DecimalInput; allReturned: boolean }): Decimal {
  if (args.allReturned) return new Decimal(1);
  const total = D(args.originalTotal);
  if (total.lte(0)) return new Decimal(1);
  const r = D(args.returnedTotal).abs().div(total);
  return r.gt(1) ? new Decimal(1) : r;
}

/**
 * The points to move now so that, all returns together, round(whole × ratio)
 * have moved; never more than what is left.
 */
export function pointsBack(whole: number, ratio: DecimalInput, alreadyBack: number): number {
  const target = roundTo(D(whole).mul(D(ratio)), 0).toNumber();
  return Math.max(0, Math.min(whole - alreadyBack, target - alreadyBack));
}

/** Same in rupees, for a gift card's share. */
export function moneyBack(whole: DecimalInput, ratio: DecimalInput, alreadyBack: DecimalInput): Decimal {
  const target = roundMoney(D(whole).mul(D(ratio)));
  const left = D(whole).sub(D(alreadyBack));
  const now = target.sub(D(alreadyBack));
  return Decimal.max(ZERO, Decimal.min(left, now));
}

export interface ReturnSplitInput {
  /** The original sale bill's total. */
  originalTotal: DecimalInput;
  /** Earlier completed returns against it (their totals, as positive amounts). */
  returnedBefore: DecimalInput;
  /** This return's refund, as a positive amount. */
  thisReturn: DecimalInput;
  /** After this return every line of the bill has come back. */
  allReturned: boolean;
  /** Points spent on the original bill and given back by earlier returns. */
  points: { spent: number; restoredBefore: number } | null;
  /** What a point is worth today (the points go back at today's value). */
  pointValue: DecimalInput;
  /** Gift cards that paid the original bill: what each paid and got back already; an expired card is refunded by the till instead. */
  giftCards: { key: string; paid: DecimalInput; refundedBefore: DecimalInput; usable: boolean }[];
}

export interface ReturnSplit {
  ratio: Decimal;
  /** Points given back and their value now. */
  points: number;
  pointsValue: Decimal;
  /** Money put back on each card. */
  giftCards: { key: string; amount: Decimal }[];
  /** What the till still refunds with its own methods. */
  rest: Decimal;
}

/**
 * How the refund of a return against a bill paid partly with points or gift
 * cards is split (decision 16; plan 13 §2 "refunds"): the points spent and the
 * gift card money go back in proportion to what is returned; the rest is
 * refunded by the till. The parts never add up to more than the refund.
 */
export function returnRefundSplit(input: ReturnSplitInput): ReturnSplit {
  const ratio = returnRatio({ originalTotal: input.originalTotal, returnedTotal: D(input.returnedBefore).add(D(input.thisReturn)), allReturned: input.allReturned });
  const refund = D(input.thisReturn).abs();
  let budget = refund;
  const giftCards: { key: string; amount: Decimal }[] = [];
  for (const g of input.giftCards) {
    let amount = g.usable ? moneyBack(g.paid, ratio, g.refundedBefore) : ZERO;
    amount = Decimal.min(amount, budget);
    budget = budget.sub(amount);
    giftCards.push({ key: g.key, amount });
  }
  let points = input.points ? pointsBack(input.points.spent, ratio, input.points.restoredBefore) : 0;
  const value = D(input.pointValue);
  if (points > 0 && value.gt(0) && pointsValue(points, value).gt(budget)) points = budget.div(value).floor().toNumber();
  const pv = pointsValue(points, value);
  return { ratio, points, pointsValue: pv, giftCards, rest: refund.sub(pv).sub(giftCards.reduce((s, g) => s.add(g.amount), ZERO)) };
}

// ---------------------------------------------------------------------------
// Gift card numbers: 16 digits, the last a check digit (Luhn), so a mistyped
// digit is caught; the other 15 are random (crypto) on the server, so a card
// cannot be guessed from another.

export const GIFT_CARD_NUMBER_LENGTH = 16;

/** The Luhn check digit for a string of digits. */
export function luhnCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error('Digits only');
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** The card number for 15 random digits (the first is never 0, so the number never loses a digit). */
export function giftCardNumberFrom(body: string): string {
  if (!/^[1-9]\d{14}$/.test(body)) throw new Error('A gift card number starts from 15 digits, the first not 0');
  return `${body}${luhnCheckDigit(body)}`;
}

/** Spaces and dashes typed or scanned with the number are dropped. */
export function normaliseGiftCardNumber(text: string): string {
  return text.replace(/[\s-]/g, '');
}

export function isValidGiftCardNumber(text: string): boolean {
  const n = normaliseGiftCardNumber(text);
  if (!/^[1-9]\d{15}$/.test(n)) return false;
  return luhnCheckDigit(n.slice(0, -1)) === Number(n.slice(-1));
}

/** "1234 5678 9012 3456" for printing and reading out. */
export function formatGiftCardNumber(n: string): string {
  return normaliseGiftCardNumber(n).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Only the last four digits, for receipts and lists after the sale ("**** 3456"). */
export function maskGiftCardNumber(n: string): string {
  return `**** ${normaliseGiftCardNumber(n).slice(-4)}`;
}

/** A date `months` later; the 31st becomes the month's last day when the month is shorter. */
export function addMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const d = Number(date.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The day a card stops working: issue date + 12 months. It can be spent up to the day before. */
export function giftCardExpiresOn(issuedOn: string, months: number = GIFT_CARD_VALIDITY_MONTHS): string {
  return addMonths(issuedOn, months);
}

/** Why a card cannot be used today, or null. */
export function giftCardProblem(card: { status: string; expiresOn: string; balance?: DecimalInput }, date: string): string | null {
  if (card.status === 'blocked') return 'This gift card is blocked';
  if (card.status === 'expired' || card.expiresOn <= date) return `This gift card expired on ${card.expiresOn}`;
  return null;
}

// ---------------------------------------------------------------------------
// Paying with points and gift cards at the till. The database's list of
// payment kinds is fixed (cash, card, UPI, other, on account), so these two
// methods are "other" methods told apart by the account their money goes to.

export const LOYALTY_PAYMENT_ROLE = 'loyalty_liability';
export const GIFT_CARD_PAYMENT_ROLE = 'gift_card_liability';

/** The two payment methods every company gets (race-safe; existing companies get them added). */
export const SPECIAL_PAYMENT_METHODS = [
  { code: 'POINTS', name: 'Loyalty points', kind: 'other', accountRole: LOYALTY_PAYMENT_ROLE, allowRefund: true, needsReference: false, module: 'loyalty' },
  { code: 'GIFTCARD', name: 'Gift card', kind: 'other', accountRole: GIFT_CARD_PAYMENT_ROLE, allowRefund: true, needsReference: false, module: 'gift_cards' },
] as const;

export type PaymentUse = 'cash' | 'card' | 'upi' | 'other' | 'on_account' | 'points' | 'gift_card';

/** What a payment method is used for: its kind, or points / gift card from its account. */
export function paymentUse(m: { kind: string; accountRole?: string | null }): PaymentUse {
  if (m.accountRole === LOYALTY_PAYMENT_ROLE) return 'points';
  if (m.accountRole === GIFT_CARD_PAYMENT_ROLE) return 'gift_card';
  return m.kind as PaymentUse;
}

/** True for the points and gift card methods (the till never offers them as plain buttons). */
export function isSpecialPaymentMethod(m: { kind: string; accountRole?: string | null }): boolean {
  const use = paymentUse(m);
  return use === 'points' || use === 'gift_card';
}

// ---------------------------------------------------------------------------
// What the API answers (shared with the web app)

export interface LoyaltySettingsDto {
  schemeName: string;
  earnSpend: string;
  earnPoints: number;
  pointValue: string;
  validityDays: number;
  minRedeem: number;
  maxSharePercent: string;
  joinAll: boolean;
  customerGroupIds: string[];
  expiryTo: LoyaltyExpiryTo;
  tiers: LoyaltyTierDto[];
}

export interface LoyaltyTierDto {
  id: string;
  name: string;
  spendFrom: string;
  earnSpend: string;
  earnPoints: number;
  sortOrder: number;
}

/** A customer's points: balance, tier, what expires soon, and the history. */
export interface CustomerLoyaltyDto {
  customerId: string;
  member: boolean;
  /** Why not a member (walk-in, not in a joining group), when not. */
  reason: string | null;
  balance: number;
  balanceValue: string;
  /** Spendable today (expired points not yet written back are left out). */
  available: number;
  tier: { name: string; earnSpend: string; earnPoints: number } | null;
  /** Spend that counts for the tier: the last 12 months. */
  yearSpend: string;
  expiringSoon: { expiresOn: string; points: number }[];
  /** Plan 13: the most points the till lets the customer spend, worked out by the till per bill. */
  minRedeem: number;
  maxSharePercent: string;
  pointValue: string;
  history?: LoyaltyEntryDto[];
}

export interface LoyaltyEntryDto {
  id: string;
  kind: 'earn' | 'spend' | 'expire' | 'reverse_earn' | 'restore_spend';
  points: number;
  value: string;
  billId: string | null;
  billNumber: string | null;
  entryDate: string;
  expiresOn: string | null;
  remaining: number | null;
  storeId: string | null;
}

export interface GiftCardDto {
  id: string;
  number: string;
  holderName: string | null;
  holderPhone: string | null;
  customerId: string | null;
  issuedStoreId: string;
  issuedOn: string;
  loadedTotal: string;
  balance: string;
  expiresOn: string;
  status: 'active' | 'blocked' | 'expired';
  blockedReason: string | null;
  entries?: GiftCardEntryDto[];
}

export interface GiftCardEntryDto {
  id: string;
  kind: 'load' | 'spend' | 'refund' | 'expire';
  amount: string;
  balanceAfter: string;
  billId: string | null;
  billNumber: string | null;
  storeId: string | null;
  entryDate: string;
  remark: string | null;
  createdAt: string;
}

/** What a receipt prints about points (server and till receipts, Till Helper). */
export interface ReceiptLoyalty {
  scheme: string;
  earned: number;
  spent: number;
  /** Given back (returns, cancellations) and taken back. */
  restored: number;
  reversed: number;
  /** The customer's balance after this bill; null when not known (offline). */
  balance: number | null;
  /** Shown on offline receipts: points are added when the till is back online. */
  note: string | null;
}

/** What a receipt prints about a gift card: sold or loaded (full number with a barcode) or spent / refunded (last 4 digits). */
export interface ReceiptGiftCard {
  action: 'sold' | 'loaded' | 'spent' | 'refunded';
  /** The full number on a sale or load receipt; masked otherwise. */
  number: string;
  /** Print a barcode of `number` (sale and load receipts only). */
  barcode: boolean;
  amount: string;
  balance: string;
  expiresOn: string;
}
