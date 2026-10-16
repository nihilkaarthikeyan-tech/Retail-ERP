// Copyright (c) 2026, Rademics. All rights reserved.
// Accounting calculations (blueprint 11 "Calculations"; plan 07 §3).
// Pure functions on decimal strings, shared by the API (authoritative) and the
// web forms (preview only). Rounding comes from rounding.ts (rule 2).
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

export const ACCOUNT_FAMILIES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountFamilyCode = (typeof ACCOUNT_FAMILIES)[number];

/** How far debits and credits may differ before a posting is refused (blueprint 11 process 1). */
export const POSTING_TOLERANCE = {
  /** Bills, till shifts and stock postings: up to 50 paise goes to Rounding. */
  document: new Decimal('0.50'),
  /** Journals and payments: up to 5 paise. */
  journal: new Decimal('0.05'),
} as const;

export interface PostingLineInput {
  /** Lines with the same key are combined (same account, store, party, open item). */
  key: string;
  debit?: DecimalInput;
  credit?: DecimalInput;
}

export interface CombinedLine {
  key: string;
  debit: Decimal;
  credit: Decimal;
}

export type PostingResult =
  | { ok: true; lines: CombinedLine[]; rounding: Decimal }
  | { ok: false; difference: Decimal };

/**
 * Combines lines with the same key, nets each to one side (negative amounts move
 * to the other side), drops zero lines, and checks the balance. `rounding` is
 * the amount to post to the Rounding account (positive = a debit is needed).
 */
export function combinePosting(lines: PostingLineInput[], tolerance: DecimalInput): PostingResult {
  const net = new Map<string, Decimal>();
  for (const l of lines) {
    const amount = roundMoney(l.debit ?? 0).sub(roundMoney(l.credit ?? 0));
    net.set(l.key, (net.get(l.key) ?? ZERO).add(amount));
  }
  const out: CombinedLine[] = [];
  let difference = ZERO;
  for (const [key, amount] of net) {
    if (amount.isZero()) continue;
    difference = difference.add(amount);
    out.push({ key, debit: amount.gt(0) ? amount : ZERO, credit: amount.lt(0) ? amount.neg() : ZERO });
  }
  if (difference.abs().gt(D(tolerance))) return { ok: false, difference };
  return { ok: true, lines: out, rounding: difference.neg() };
}

/** Balance shown the natural way round: assets and expenses as debit, the rest as credit. */
export function naturalBalance(family: AccountFamilyCode, debit: DecimalInput, credit: DecimalInput): Decimal {
  const dr = D(debit).sub(D(credit));
  return family === 'asset' || family === 'expense' ? dr : dr.neg();
}

/** Whether a "must be debit / must be credit" account has gone the wrong way. */
export function wrongSideBalance(mustBe: 'debit' | 'credit' | null | undefined, debitMinusCredit: DecimalInput): boolean {
  if (!mustBe) return false;
  const b = D(debitMinusCredit);
  return mustBe === 'debit' ? b.lt(0) : b.gt(0);
}

export const DEFAULT_AGEING_BANDS = [30, 60, 90, 120] as const;

/** Whole days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** The age band a bill falls in: "Not due", "0–30", "31–60", …, "Over 120". */
export function ageBand(dueOrBillDate: string, asOf: string, bands: readonly number[] = DEFAULT_AGEING_BANDS): string {
  const days = daysBetween(dueOrBillDate, asOf);
  if (days < 0) return 'Not due';
  let lower = 0;
  for (const b of bands) {
    if (days <= b) return lower === 0 ? `0–${b}` : `${lower + 1}–${b}`;
    lower = b;
  }
  return `Over ${lower}`;
}

/** Every band label in order, for report columns. */
export function ageBandLabels(bands: readonly number[] = DEFAULT_AGEING_BANDS): string[] {
  const labels = ['Not due'];
  let lower = 0;
  for (const b of bands) {
    labels.push(lower === 0 ? `0–${b}` : `${lower + 1}–${b}`);
    lower = b;
  }
  labels.push(`Over ${lower}`);
  return labels;
}

export interface OpenItem {
  id: string;
  /** What is still owed on it (positive). */
  open: DecimalInput;
  /** Bill or due date, for "oldest first". */
  date: string;
}

/** Settles `amount` against the open items, oldest first; returns what goes to each and what is left over. */
export function settleOldestFirst(amount: DecimalInput, items: OpenItem[]): { allocations: { id: string; amount: Decimal }[]; leftOver: Decimal } {
  let left = roundMoney(amount);
  const allocations: { id: string; amount: Decimal }[] = [];
  const sorted = [...items].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
  for (const it of sorted) {
    if (left.lte(0)) break;
    const open = roundMoney(it.open);
    if (open.lte(0)) continue;
    const take = Decimal.min(open, left);
    allocations.push({ id: it.id, amount: take });
    left = left.sub(take);
  }
  return { allocations, leftOver: left };
}

export interface CreditCheckInput {
  /** 0 = no credit allowed (decision 22, module 3). */
  creditLimit: DecimalInput;
  /** What the customer owes now, including on-account bills not yet posted. */
  owed: DecimalInput;
  thisBill: DecimalInput;
  /** Amount past its due date. */
  overdue: DecimalInput;
  overdueLimit: DecimalInput;
}

export type CreditVerdict = { ok: true } | { ok: false; reason: string; canOverride: boolean };

/** Decision 22: credit only for approved customers; hard block above the limit, overridable by a manager. */
export function creditCheck(c: CreditCheckInput): CreditVerdict {
  const limit = D(c.creditLimit);
  if (limit.lte(0)) return { ok: false, reason: 'This customer is not approved for credit', canOverride: false };
  const after = D(c.owed).add(D(c.thisBill));
  if (after.gt(limit)) {
    return { ok: false, reason: `Over the credit limit: owes ₹${roundMoney(c.owed).toFixed(2)}, limit ₹${limit.toFixed(2)}, this bill ₹${roundMoney(c.thisBill).toFixed(2)}`, canOverride: true };
  }
  if (D(c.overdue).gt(D(c.overdueLimit))) {
    return { ok: false, reason: `₹${roundMoney(c.overdue).toFixed(2)} is overdue (allowed ₹${D(c.overdueLimit).toFixed(2)})`, canOverride: true };
  }
  return { ok: true };
}
