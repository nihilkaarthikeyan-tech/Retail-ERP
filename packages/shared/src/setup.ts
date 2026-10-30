// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §3 and §4: the step-by-step first-time setup and the getting-started
// checklist on the owner's dashboard. Pure data and rules, shared by the API and the web.
import { businessDate } from './business-date.js';
import { type ModuleKey, modulesForShopType, type ShopTypeKey, withNeeds } from './modules.js';

/**
 * The steps of the guided setup, in order. Step numbers start at 1. Plan 14: the
 * owner's name, email and password come from sign-up, so setup starts at the business.
 */
export const SETUP_STEPS = [
  { key: 'business', title: 'Your business', lead: 'The business as it appears on bills and in the accounts.' },
  { key: 'gst', title: 'GST', lead: 'Your GST registration, if you have one. You can add it later too.' },
  { key: 'shop', title: 'Your first shop', lead: 'The shop you start with. More shops can be added later.' },
  { key: 'sell', title: 'What do you sell?', lead: 'Pick the kind of shop. It switches on what you need; change anything you like.' },
  { key: 'done', title: 'Done', lead: 'Check what will be set up, then finish.' },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]['key'];
/** The steps whose answers are saved as you go ("done" only shows a summary). */
export type SetupAnswerKey = Exclude<SetupStepKey, 'done'>;
export const SETUP_ANSWER_KEYS: SetupAnswerKey[] = ['business', 'gst', 'shop', 'sell'];
export const SETUP_LAST_STEP = SETUP_STEPS.length;

/** Step number (1-based) of a step key. */
export function setupStepNumber(key: SetupStepKey): number {
  return SETUP_STEPS.findIndex((s) => s.key === key) + 1;
}

/**
 * The Indian financial year (1 April to 31 March) that holds today's Indian
 * date (Income-tax Act "previous year"; GST returns follow the same year).
 */
export function indianFinancialYear(now: Date = new Date()): { startDate: string; endDate: string } {
  const [year, month] = businessDate(now).split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return { startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` };
}

/**
 * The ticks the "What do you sell?" step starts with: the shop type's modules,
 * plus e-invoice when the turnover is above ₹5 crore (e-invoicing applies above
 * ₹5 crore aggregate turnover; CBIC notification 10/2023-Central Tax, see https://einvoice1.gst.gov.in).
 */
export function suggestedModules(type: ShopTypeKey, turnoverBand?: string | null): Record<ModuleKey, boolean> {
  const map = modulesForShopType(type);
  if (turnoverBand && turnoverBand !== 'up_to_5cr') map.einvoice = true;
  return map;
}

/** A module map with every needed module switched on too (plan 12 §1 rule 3). */
export function withAllNeeds(map: Record<ModuleKey, boolean>): Record<ModuleKey, boolean> {
  const out = { ...map };
  for (const key of Object.keys(map) as ModuleKey[]) if (map[key]) for (const n of withNeeds(key)) out[n] = true;
  return out;
}

/** The tills made at setup: T1 "Till 1", T2 "Till 2", … */
export function setupTills(count: number): { code: string; name: string }[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => ({ code: `T${i + 1}`, name: `Till ${i + 1}` }));
}

/** The payment methods each till made at setup takes; cash is the default. */
export const SETUP_TILL_PAYMENT_METHODS = ['CASH', 'CARD', 'UPI'] as const;

// ---- Getting-started checklist (plan 12 §4) ----

export const GETTING_STARTED_STEPS = [
  { key: 'tills', label: 'Add tills and payment methods', hint: 'A till for each billing counter, the ways customers pay you (cash, card, UPI), and on each counter computer: open its till and press "Use this computer as till".', href: '/pos/tills' },
  { key: 'items', label: 'Import or add your items', hint: 'Bring your item list in from Excel, or add items one by one.', href: '/items' },
  { key: 'opening_stock', label: 'Load your opening stock', hint: 'Count what is on the shelves today, or import the quantities from Excel.', href: '/stock/counts/new?type=opening' },
  { key: 'staff', label: 'Add your staff and their rights', hint: 'A login for each person, with only the rights they need.', href: '/users/new' },
  { key: 'letterhead', label: 'Set your letterhead and logo', hint: 'Your logo and address at the top of printed documents.', href: '/printing' },
  { key: 'gst_rates', label: 'Set GST rates for your HSN codes', hint: 'The GST rate for each HSN code you sell. A rate applies to bills as soon as it is saved.', href: '/pos/gst-rates' },
  { key: 'test_bill', label: 'Make a test bill', hint: 'Sell something at the till to see the bill, the stock and the accounts move.', href: '/till' },
  { key: 'go_live', label: 'Set your go-live date', hint: 'The day real trading starts. Test bills before it can be cleared away.', href: '/go-live' },
] as const;

export type GettingStartedKey = (typeof GETTING_STARTED_STEPS)[number]['key'];

export interface GettingStartedStep {
  key: GettingStartedKey;
  label: string;
  hint: string;
  href: string;
  done: boolean;
  /** A short word on where it stands, e.g. "2 tills". */
  note: string | null;
}

export interface GettingStartedDto {
  hidden: boolean;
  steps: GettingStartedStep[];
  doneCount: number;
  total: number;
}
