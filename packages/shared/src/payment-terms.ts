// Copyright (c) 2026, Rademics. All rights reserved.
// Due dates from payment terms (blueprint 05, calculations). Pure date maths
// on ISO calendar dates; used by sales, purchasing and accounting later.
import { addDays } from './financial-year.js';

export const DUE_BASES = ['days_after_date', 'days_after_month_end', 'months_then_month_end'] as const;
export type DueBasis = (typeof DUE_BASES)[number];

export interface PaymentTermsPartLike {
  /** Share of the bill this part covers, in percent. */
  share: string | number;
  dueBasis: DueBasis;
  days: number;
  months: number;
}

function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return last.toISOString().slice(0, 10);
}

function addMonthsKeepingMonthEnd(isoDate: string, months: number): string {
  const [y, m] = isoDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  return endOfMonth(first.toISOString().slice(0, 10));
}

/** The due date of one part counted from the bill date; never before it. */
export function partDueDate(billDate: string, part: Pick<PaymentTermsPartLike, 'dueBasis' | 'days' | 'months'>): string {
  let due: string;
  switch (part.dueBasis) {
    case 'days_after_date':
      due = addDays(billDate, part.days);
      break;
    case 'days_after_month_end':
      due = addDays(endOfMonth(billDate), part.days);
      break;
    case 'months_then_month_end':
      due = addMonthsKeepingMonthEnd(billDate, part.months);
      break;
  }
  return due < billDate ? billDate : due;
}

/** Due dates per part plus the overall due date (the latest part). */
export function dueDates(billDate: string, parts: PaymentTermsPartLike[]): { parts: { share: string; dueDate: string }[]; dueDate: string } {
  if (parts.length === 0) return { parts: [], dueDate: billDate };
  const out = parts.map((p) => ({ share: String(p.share), dueDate: partDueDate(billDate, p) }));
  const dueDate = out.reduce((latest, p) => (p.dueDate > latest ? p.dueDate : latest), billDate);
  return { parts: out, dueDate };
}

/** Shares of a terms template must add up to exactly 100. */
export function sharesProblem(parts: { share: string | number }[]): string | null {
  const total = parts.reduce((sum, p) => sum + Number(p.share), 0);
  if (Math.abs(total - 100) > 1e-9) return `Shares add up to ${total}%, not 100%`;
  return null;
}
