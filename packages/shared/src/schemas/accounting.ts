// Copyright (c) 2026, Rademics. All rights reserved.
// Module 7 input validation (plan 07).
import { z } from 'zod';
import { isIsoDate } from '../financial-year.js';
import { decimalString, positiveDecimalString } from './catalogue.js';
import { queryBoolean } from './reports.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Choose a date');
const uuid = z.uuid();

/** How the system uses an account (blueprint 11 "Chart of accounts"). */
export const ACCOUNT_KINDS = [
  'cash',
  'bank',
  'receivable',
  'payable',
  'stock',
  'transit',
  'grni',
  'cogs',
  'tax',
  'rounding',
  'temporary_opening',
  'income',
  'expense',
  'equity',
  'other',
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank',
  receivable: 'Customer balances',
  payable: 'Supplier balances',
  stock: 'Stock',
  transit: 'Goods in transit',
  grni: 'Goods received not billed',
  cogs: 'Cost of goods sold',
  tax: 'Tax',
  rounding: 'Rounding',
  temporary_opening: 'Temporary opening',
  income: 'Income',
  expense: 'Expense',
  equity: 'Capital and reserves',
  other: 'Other',
};

/**
 * Every kind of money the other modules post, and the label shown on the
 * "Default accounts" screen. Cash in till and cash in hand are per store.
 */
export const ACCOUNT_ROLES = {
  stock: 'Stock in hand',
  goods_in_transit: 'Goods in transit between stores',
  stock_transfer_clearing: 'Stock transfer clearing',
  goods_received_not_billed: 'Goods received not billed',
  supplier_payable: 'Supplier balances',
  /** Plan 11 part 2: sale-or-return goods held, owed only once sold and settled by a statement. */
  consignment_payable: 'Owed to suppliers on consignment',
  customer_receivable: 'Customer balances',
  gst_input_cgst: 'Input CGST',
  gst_input_sgst: 'Input SGST',
  gst_input_igst: 'Input IGST',
  gst_output_cgst: 'Output CGST',
  gst_output_sgst: 'Output SGST',
  gst_output_igst: 'Output IGST',
  /** Plan 08 G8: tax the shop pays itself on purchases under reverse charge. */
  gst_rcm_cgst: 'CGST payable under reverse charge',
  gst_rcm_sgst: 'SGST payable under reverse charge',
  gst_rcm_igst: 'IGST payable under reverse charge',
  sales: 'Sales',
  cost_of_goods_sold: 'Cost of goods sold',
  purchase_expense: 'Purchases of services and expenses',
  freight_inward: 'Freight inward',
  purchase_price_difference: 'Purchase price difference',
  stock_adjustment: 'Stock adjustment',
  write_off: 'Stock written off',
  samples_expense: 'Free samples',
  shop_use_expense: 'Goods used in the shop',
  rounding: 'Rounding',
  temporary_opening: 'Temporary opening',
  card_settlement: 'Card settlement',
  upi_settlement: 'UPI settlement',
  other_receipts: 'Other receipts at the till',
  cash_short_over: 'Cash short or over',
  card_commission: 'Card and UPI commission',
  bank_charges: 'Bank charges',
  bad_debts: 'Small amounts written off',
  retained_earnings: 'Retained earnings',
  /** Plan 13 (decision 15): points earned are an expense and a liability until spent or expired. */
  loyalty_expense: 'Loyalty points expense',
  loyalty_liability: 'Loyalty points owed to customers',
  /** Plan 13 (decision 14): money on gift cards is owed to the holders. */
  gift_card_liability: 'Gift card balances owed',
  /** Plan 13: where expired points (when chosen) and expired gift card balances are written back. */
  other_income: 'Other income',
  gift_card_expiry: 'Expired gift card balances',
} as const;
export type AccountRole = keyof typeof ACCOUNT_ROLES;

/** Roles whose default account is another role's standard account (the accountant can point them elsewhere). */
export const ROLE_DEFAULT_ACCOUNT: Partial<Record<AccountRole, string>> = { gift_card_expiry: 'other_income' };

/** Per-store accounts, created for every store (plan 07 §1.5). */
export const STORE_ACCOUNT_ROLES = { cash_in_till: 'Cash in till', cash_in_hand: 'Cash in hand' } as const;
export type StoreAccountRole = keyof typeof STORE_ACCOUNT_ROLES;

export const PARTY_TYPES = ['customer', 'supplier'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

// ---- Chart of accounts ----

export const createAccountSchema = z.object({
  parentId: uuid,
  number: z.string().trim().max(20).optional().nullable(),
  name: trimmed(100),
  isGroup: z.boolean().default(false),
  kind: z.enum(ACCOUNT_KINDS).optional().nullable(),
  storeId: uuid.optional().nullable(),
  balanceMustBe: z.enum(['debit', 'credit']).optional().nullable(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z
  .object({
    parentId: uuid,
    number: z.string().trim().max(20).nullable(),
    name: trimmed(100),
    kind: z.enum(ACCOUNT_KINDS).nullable(),
    balanceMustBe: z.enum(['debit', 'credit']).nullable(),
    active: z.boolean(),
  })
  .partial();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const lockAccountSchema = z.object({ locked: z.boolean() });

export const approveChartSchema = z.object({ note: trimmed(300) });

export const setDefaultsSchema = z.object({
  defaults: z.array(z.object({ role: z.string().refine((r) => r in ACCOUNT_ROLES, 'Unknown account kind'), accountId: uuid })).min(1),
});
export type SetDefaultsInput = z.infer<typeof setDefaultsSchema>;

export const bankAccountSchema = z.object({
  accountId: uuid,
  bankName: trimmed(100),
  accountNumber: z.string().trim().regex(/^[0-9A-Za-z]{4,34}$/, 'Account number: letters and digits only'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Not a valid IFSC')
    .optional()
    .nullable(),
  branch: optionalText(100),
  isDefault: z.boolean().default(false),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export const updateBankAccountSchema = bankAccountSchema.omit({ accountId: true }).extend({ active: z.boolean() }).partial();

// ---- Journals ----

/** "expense" journals are made only by the simple expense entry (plan 11 C8), never on the journal form. */
export const JOURNAL_KINDS = ['general', 'cash', 'bank', 'contra', 'credit_note', 'debit_note', 'write_off', 'opening', 'expense'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const journalLineSchema = z
  .object({
    accountId: uuid,
    storeId: uuid.optional().nullable(),
    partyType: z.enum(PARTY_TYPES).optional().nullable(),
    partyId: uuid.optional().nullable(),
    debit: decimalString.optional().nullable(),
    credit: decimalString.optional().nullable(),
    againstType: z.string().trim().max(40).optional().nullable(),
    againstId: uuid.optional().nullable(),
    remark: optionalText(200),
  })
  .refine((l) => !(Number(l.debit ?? 0) !== 0 && Number(l.credit ?? 0) !== 0), 'A line cannot be both debit and credit')
  .refine((l) => Number(l.debit ?? 0) !== 0 || Number(l.credit ?? 0) !== 0, 'Each line needs a debit or a credit')
  .refine((l) => !l.partyType === !l.partyId, 'Choose both the kind of party and the party')
  .refine((l) => !l.againstId || !!l.partyId, 'A line against a bill must name the party');
export type JournalLineInput = z.infer<typeof journalLineSchema>;

export const journalSchema = z.object({
  kind: z
    .enum(JOURNAL_KINDS)
    .default('general')
    .refine((k) => k !== 'expense', 'Expenses are entered on the Add expense screen'),
  journalDate: isoDate,
  reference: optionalText(60),
  referenceDate: isoDate.optional().nullable(),
  remark: optionalText(300),
  lines: z.array(journalLineSchema).min(2, 'A journal needs at least two lines').max(200),
});
export type JournalInput = z.infer<typeof journalSchema>;

export const cancelSchema = z.object({ reason: trimmed(300) });

// ---- Simple expenses (plan 11 C8) ----

/** Rupees and paise only: an expense is paid in whole paise. */
const moneyAmount = positiveDecimalString.refine((v) => !/\.\d{3,}$/.test(v), 'At most two digits after the point (paise)');

export const expenseSchema = z.object({
  expenseDate: isoDate,
  storeId: uuid,
  /** A bottom-level expense account (rent, salaries, electricity…). */
  expenseAccountId: uuid,
  /** The store's cash in hand account, or a bank account. */
  paidFromAccountId: uuid,
  amount: moneyAmount,
  reference: optionalText(60),
  remark: optionalText(300),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const expenseListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  storeId: uuid.optional(),
  expenseAccountId: uuid.optional(),
  status: z.enum(['posted', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

// ---- Payments ----

export const PAYMENT_DOC_KINDS = ['receipt', 'payment', 'transfer'] as const;
export type PaymentDocKind = (typeof PAYMENT_DOC_KINDS)[number];

export const paymentSchema = z
  .object({
    kind: z.enum(PAYMENT_DOC_KINDS),
    paymentDate: isoDate,
    storeId: uuid.optional().nullable(),
    partyType: z.enum(PARTY_TYPES).optional().nullable(),
    partyId: uuid.optional().nullable(),
    fromAccountId: uuid.optional().nullable(),
    toAccountId: uuid.optional().nullable(),
    // Audit 2 (28 October 2026): whole paise, so the checks against what is owed compare like with like.
    amount: moneyAmount,
    reference: optionalText(60),
    referenceDate: isoDate.optional().nullable(),
    clearedOn: isoDate.optional().nullable(),
    remark: optionalText(300),
    /** Bills it settles; omitted = settle oldest first. */
    allocations: z.array(z.object({ billType: z.string().trim().max(40), billId: uuid, amount: moneyAmount })).max(200).optional(),
    autoSettle: z.boolean().default(true),
    deductions: z.array(z.object({ accountId: uuid, amount: moneyAmount, remark: optionalText(200) })).max(10).default([]),
  })
  .refine((p) => p.kind === 'transfer' || (!!p.partyType && !!p.partyId), 'Choose the customer or supplier')
  .refine((p) => p.kind !== 'receipt' || p.partyType === 'customer', 'A receipt is money from a customer')
  .refine((p) => p.kind !== 'payment' || p.partyType === 'supplier', 'A payment is money to a supplier')
  .refine((p) => p.kind !== 'receipt' || !!p.toAccountId, 'Choose the cash or bank account the money goes to')
  .refine((p) => p.kind !== 'payment' || !!p.fromAccountId, 'Choose the cash or bank account the money comes from')
  .refine((p) => p.kind !== 'transfer' || (!!p.fromAccountId && !!p.toAccountId && p.fromAccountId !== p.toAccountId), 'A transfer needs two different accounts');
export type PaymentInput = z.infer<typeof paymentSchema>;

export const settleSchema = z.object({
  partyType: z.enum(PARTY_TYPES),
  partyId: uuid,
  billType: z.string().trim().max(40),
  billId: uuid,
  byType: z.string().trim().max(40),
  byId: uuid,
  amount: positiveDecimalString,
});
export type SettleInput = z.infer<typeof settleSchema>;

// ---- Opening balances ----

export const openingBillSchema = z.object({
  partyType: z.enum(PARTY_TYPES),
  partyId: uuid,
  storeId: uuid.optional().nullable(),
  billNumber: trimmed(40),
  billDate: isoDate,
  dueDate: isoDate.optional().nullable(),
  amount: positiveDecimalString,
});
export type OpeningBillInput = z.infer<typeof openingBillSchema>;

// ---- Protecting the books ----

export const lockDateSchema = z.object({ lockDate: isoDate.nullable(), reason: trimmed(300) });
export const yearEndClosingSchema = z.object({ financialYearId: uuid, closingAccountId: uuid, remark: optionalText(300) });
export type YearEndClosingInput = z.infer<typeof yearEndClosingSchema>;

// ---- Queries ----

export const ledgerQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: uuid.optional(),
  storeId: uuid.optional(),
  partyType: z.enum(PARTY_TYPES).optional(),
  partyId: uuid.optional(),
  documentType: z.string().max(40).optional(),
  documentId: uuid.optional(),
  includeCancelled: queryBoolean.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const periodQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  storeId: uuid.optional(),
  showZero: queryBoolean.optional(),
  groupBy: z.enum(['month', 'year']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
});
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

/** Cash book or bank book (plan 11 C8): one cash or bank account, or a store's cash in hand. */
export const cashBookQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    accountId: uuid.optional(),
    storeId: uuid.optional(),
    includeCancelled: queryBoolean.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(2000).optional(),
  })
  .refine((q) => !!q.accountId || !!q.storeId, 'Choose a cash or bank account, or a store')
  .refine((q) => q.from <= q.to, 'The start date is after the end date');
export type CashBookQuery = z.infer<typeof cashBookQuerySchema>;

export const asOfQuerySchema = z.object({ asOf: isoDate, storeId: uuid.optional(), partyType: z.enum(PARTY_TYPES).optional() });
export type AsOfQuery = z.infer<typeof asOfQuerySchema>;

export const docListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).optional(),
  kind: z.string().max(20).optional(),
  partyId: uuid.optional(),
  search: z.string().trim().max(60).optional(),
});
export type DocListQuery = z.infer<typeof docListQuerySchema>;

