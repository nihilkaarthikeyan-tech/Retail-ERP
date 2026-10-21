// Copyright (c) 2026, Rademics. All rights reserved.
// Types, labels and small helpers shared by the accounts (module 7) screens.
// The shapes mirror the API's DTOs (apps/api/src/accounting/*.service.ts).
// Money is always a decimal string and every sum here uses Decimal (rule 1);
// the figures are previews only, the API's answer is what counts.
import { type AccountKind, type CurrentUser, Decimal, hasPermission, JOURNAL_KINDS, type JournalKind, settleOldestFirst } from "shared";

export type AccountFamily = "asset" | "liability" | "equity" | "income" | "expense";
export type DocStatus = "draft" | "posted" | "cancelled";
export type PaymentKind = "receipt" | "payment" | "transfer";
export type PartyKind = "customer" | "supplier";

/** One account of GET /accounts (folders add up their children). */
export interface AccountDto {
  id: string;
  parentId: string | null;
  number: string | null;
  name: string;
  isGroup: boolean;
  family: AccountFamily;
  kind: AccountKind | null;
  storeId: string | null;
  balanceMustBe: "debit" | "credit" | null;
  locked: boolean;
  active: boolean;
  systemKey: string | null;
  /** Shown the natural way round: assets and expenses as debit, the rest as credit. */
  balance?: string;
  debitMinusCredit?: string;
  usedFor?: string[];
}

export interface ChartDto {
  approval: { approvedAt: string; approvedById: string | null; note: string | null } | null;
  accounts: AccountDto[];
}

export interface AccountingSettingsDto {
  chartApprovedAt: string | null;
  chartApprovedById: string | null;
  chartApprovalNote: string | null;
  ageingBands: number[];
  lockDate: string | null;
}

export interface DefaultAccountRow {
  role: string;
  label: string;
  account: AccountDto | null;
}

export interface BankAccountDto {
  id: string;
  account: AccountDto;
  bankName: string;
  accountNumber: string;
  maskedNumber: string;
  ifsc: string | null;
  branch: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface JournalLineDto {
  lineNo: number;
  accountId: string;
  storeId: string | null;
  partyType: PartyKind | null;
  partyId: string | null;
  debit: string;
  credit: string;
  againstType: string | null;
  againstId: string | null;
  remark: string | null;
}

export interface JournalDto {
  id: string;
  number: string | null;
  kind: JournalKind;
  journalDate: string;
  reference: string | null;
  referenceDate: string | null;
  remark: string | null;
  status: DocStatus;
  ledgerEntryId: string | null;
  total: string;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: JournalLineDto[];
}

export interface PaymentDto {
  id: string;
  number: string | null;
  kind: PaymentKind;
  paymentDate: string;
  storeId: string | null;
  partyType: PartyKind | null;
  partyId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: string;
  deductions: { accountId: string; amount: string; remark: string | null }[];
  allocations: { billType: string; billId: string; amount: string }[];
  /** Paid or received beyond the bills (the advance). */
  unused: string;
  reference: string | null;
  referenceDate: string | null;
  clearedOn: string | null;
  remark: string | null;
  status: DocStatus;
  ledgerEntryId: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** GET /parties/:type/:id/open-items: unpaid bills (owed > 0) and unused payments (owed < 0). */
export interface OpenItemDto {
  itemType: string;
  itemId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  amount: string;
  settled?: string;
  owed: string;
}

export interface OpeningBillDto {
  id: string;
  partyType: PartyKind;
  partyId: string;
  storeId: string | null;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  amount: string;
  owed: string;
  status: "posted" | "cancelled";
}

export interface OpeningCheckDto {
  account: { id: string; name: string };
  debit: string;
  credit: string;
  difference: string;
  ok: boolean;
}

export interface YearEndClosingDto {
  id: string;
  financialYearId: string;
  financialYear: string | undefined;
  periodEnd: string;
  closingAccountId: string;
  remark: string | null;
  status: "posted" | "cancelled";
  ledgerEntryId: string | null;
  createdAt: string;
}

export interface EntryLineDto {
  account: string;
  party: string | null;
  store: string | null;
  debit: string;
  credit: string;
  remark: string | null;
}

/** GET /ledger/entries?documentType=…&documentId=… */
export interface LedgerEntryDto {
  id: string;
  date: string;
  documentNumber: string | null;
  remark: string | null;
  /** Set on a cancelling entry: the entry it reverses. */
  cancels: string | null;
  lines: EntryLineDto[];
}

// ---- Simple expenses and the cash book (plan 11 C8) ----

export interface ExpenseAccountRef {
  id: string;
  number: string | null;
  name: string;
  kind: AccountKind | null;
  storeId: string | null;
  locked: boolean;
}

/** GET /expenses/options: the user's stores with their cash in hand, the expense heads and the banks. */
export interface ExpenseOptionsDto {
  stores: { id: string; code: string; name: string }[];
  cashInHand: { storeId: string; account: ExpenseAccountRef }[];
  heads: ExpenseAccountRef[];
  banks: ExpenseAccountRef[];
}

export interface ExpenseDto {
  id: string;
  number: string | null;
  expenseDate: string;
  store: { id: string; code: string; name: string } | null;
  expenseAccount: ExpenseAccountRef | null;
  paidFrom: ExpenseAccountRef | null;
  paidFromKind: "cash" | "bank";
  amount: string;
  reference: string | null;
  remark: string | null;
  status: "posted" | "cancelled";
  ledgerEntryId: string | null;
  createdAt: string;
  createdBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface ExpensePage {
  rows: ExpenseDto[];
  total: number;
  page: number;
  pageSize: number;
  /** Every posted expense that matches the filters, not only this page. */
  postedTotal: string;
}

/** GET /reports/cash-book: one cash or bank account, day by day, with the entries a page at a time. */
export interface CashBookDto {
  book: "cash" | "bank";
  account: { id: string; number: string | null; name: string; kind: AccountKind | null; storeId: string | null };
  from: string;
  to: string;
  limitedToStores: boolean;
  opening: string;
  moneyIn: string;
  moneyOut: string;
  closing: string;
  ledgerClosing: string;
  matchesLedger: boolean;
  days: { date: string; entries: number; opening: string; moneyIn: string; moneyOut: string; closing: string }[];
  page: number;
  pageSize: number;
  total: number;
  pageOpening: string;
  rows: {
    id: string;
    date: string;
    documentType: string;
    documentId: string;
    documentNumber: string | null;
    against: string;
    store: string | null;
    remark: string | null;
    moneyIn: string;
    moneyOut: string;
    balance: string;
    cancelled: boolean;
  }[];
}

/** The accounts an expense can be paid from in a store: its cash in hand first, then the banks. */
export function payFromChoices(options: ExpenseOptionsDto | null, storeId: string): ExpenseAccountRef[] {
  if (!options) return [];
  const cash = options.cashInHand.find((c) => c.storeId === storeId)?.account;
  return [...(cash ? [cash] : []), ...options.banks];
}

// ---- Labels ----

export const FAMILY_LABELS: Record<AccountFamily, string> = {
  asset: "What the shop owns (assets)",
  liability: "What the shop owes (liabilities)",
  equity: "Capital and reserves",
  income: "Income",
  expense: "Expenses",
};

export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  general: "General entry",
  cash: "Petty cash (cash spent or received)",
  bank: "Bank entry (charges, interest)",
  contra: "Moving money between own accounts",
  credit_note: "Credit note to a customer (no goods)",
  debit_note: "Debit note to a supplier (no goods)",
  write_off: "Writing off a small balance",
  opening: "Opening balances (going live)",
  expense: "Expense (from Add expense)",
};

/** Kinds offered on the journal form: expenses have their own screen (plan 11 C8). */
export const JOURNAL_FORM_KINDS: JournalKind[] = JOURNAL_KINDS.filter((k) => k !== "expense");

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  receipt: "Money received from a customer",
  payment: "Money paid to a supplier",
  transfer: "Transfer between own accounts",
};

export const PAYMENT_KIND_SHORT: Record<PaymentKind, string> = { receipt: "Receipt", payment: "Payment", transfer: "Transfer" };

export const DOC_STATUS_LABELS: Record<DocStatus, string> = { draft: "Draft", posted: "Posted", cancelled: "Cancelled" };

/** Names of the documents that post to the ledger (day book, general ledger, open bills). */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  supplier_bill: "Supplier bill",
  goods_receipt: "Goods receipt",
  stock_document: "Stock document",
  landed_charge: "Freight and charges",
  pos_shift: "Till shift",
  pos_bill: "Till bill",
  journal: "Journal",
  payment: "Receipt / payment",
  opening_bill: "Opening bill",
  year_end_closing: "Year-end closing",
  // Plan 13
  gift_card_load: "Gift card sold or reloaded",
  gift_card_expiry: "Gift cards expired",
  loyalty_expiry: "Loyalty points expired",
  loyalty_revaluation: "Loyalty point value changed",
};

export function documentLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return DOCUMENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

/** Where a document can be opened in the app, when it has its own page. */
export function documentHref(type: string, id: string): string | null {
  switch (type) {
    case "supplier_bill":
      return `/purchases/bills/${id}`;
    case "goods_receipt":
      return `/purchases/receipts/${id}`;
    case "stock_document":
      return `/stock/documents/${id}`;
    case "landed_charge":
      return `/purchases/charges/${id}`;
    case "pos_bill":
      return `/pos/bills/${id}`;
    case "journal":
      return `/accounts/journals/${id}`;
    case "payment":
      return `/accounts/payments/${id}`;
    default:
      return null;
  }
}

export function statusTone(status: DocStatus | string): "ok" | "warn" | "off" | "neutral" {
  if (status === "posted") return "ok";
  if (status === "cancelled") return "off";
  return "neutral";
}

// ---- Rights ----

/** Rights in plain names, matching the API checks. */
export function accountRights(user: CurrentUser | null) {
  const journals = hasPermission(user, "journals.post");
  const payments = hasPermission(user, "payments.post");
  const cashDeposit = hasPermission(user, "cash.deposit");
  return {
    view: hasPermission(user, "accounts.view"),
    manage: hasPermission(user, "accounts.manage"),
    approveChart: hasPermission(user, "accounts.approve_chart"),
    journals,
    payments,
    cashDeposit,
    /** May make journals at all (store managers: petty-cash journals only). */
    makeJournals: journals || cashDeposit,
    /** Only "cash" journals (store managers with cash.deposit). */
    cashJournalsOnly: !journals && cashDeposit,
    /** May make receipts and payments (not just transfers). */
    makePayments: payments,
    /** May make transfers (store managers: cash to the bank). */
    makeTransfers: payments || cashDeposit,
    lockBooks: hasPermission(user, "books.lock"),
  };
}

// ---- Accounts ----

export function accountName(a: Pick<AccountDto, "number" | "name"> | null | undefined): string {
  if (!a) return "—";
  return `${a.number ? `${a.number} ` : ""}${a.name}`;
}

/** Accounts that can take postings: bottom-level and switched on. */
export function postable(accounts: AccountDto[]): AccountDto[] {
  return accounts.filter((a) => !a.isGroup && a.active);
}

/** Which party an account needs: customer balances need the customer, supplier balances the supplier. */
export function partyFor(account: Pick<AccountDto, "kind"> | null | undefined): PartyKind | null {
  if (account?.kind === "receivable") return "customer";
  if (account?.kind === "payable") return "supplier";
  return null;
}

/** Income and expense lines need a store (profit is tracked per shop, decision 52). */
export function needsStore(account: Pick<AccountDto, "family"> | null | undefined): boolean {
  return account?.family === "income" || account?.family === "expense";
}

export interface AccountNode extends AccountDto {
  children: AccountNode[];
}

/** Turns the flat list into a tree, keeping the API's order (account number, then name). */
export function buildTree(accounts: AccountDto[]): AccountNode[] {
  const nodes = new Map<string, AccountNode>(accounts.map((a) => [a.id, { ...a, children: [] }]));
  const roots: AccountNode[] = [];
  for (const a of accounts) {
    const node = nodes.get(a.id)!;
    const parent = a.parentId ? nodes.get(a.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order: AccountFamily[] = ["asset", "liability", "equity", "income", "expense"];
  return roots.sort((x, y) => order.indexOf(x.family) - order.indexOf(y.family));
}

/** Every folder an account could move to: same family, not itself or below itself. */
export function moveTargets(accounts: AccountDto[], account: AccountDto): AccountDto[] {
  const below = new Set<string>([account.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId && below.has(a.parentId) && !below.has(a.id)) {
        below.add(a.id);
        grew = true;
      }
    }
  }
  return accounts.filter((a) => a.isGroup && a.family === account.family && !below.has(a.id));
}

// ---- Money ----

/** A typed amount as a Decimal; anything that is not a plain number counts as zero. */
export function dec(value: string | null | undefined): Decimal {
  const t = (value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return new Decimal(0);
  return new Decimal(t);
}

export interface JournalTotals {
  debit: Decimal;
  credit: Decimal;
  /** Debits minus credits: positive means a credit is missing. */
  difference: Decimal;
  balanced: boolean;
}

/** Live totals of the journal form. */
export function journalTotals(lines: { debit: string; credit: string }[]): JournalTotals {
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  for (const l of lines) {
    debit = debit.add(dec(l.debit));
    credit = credit.add(dec(l.credit));
  }
  const difference = debit.sub(credit);
  return { debit, credit, difference, balanced: difference.isZero() && debit.gt(0) };
}

/** The line that makes a journal balance: a credit when debits are larger, a debit otherwise. */
export function balancingAmounts(difference: Decimal): { debit: string; credit: string } {
  if (difference.gt(0)) return { debit: "", credit: difference.toFixed(2) };
  if (difference.lt(0)) return { debit: difference.neg().toFixed(2), credit: "" };
  return { debit: "", credit: "" };
}

export interface SettlePreviewRow {
  item: OpenItemDto;
  amount: Decimal;
}

/**
 * Preview of "oldest first" on the payment form, the same rule the API uses:
 * by due date (or bill date), then bill date, then number. Only bills that are
 * owed something take part; the rest of the money stays as an advance.
 */
export function previewOldestFirst(covers: Decimal, items: OpenItemDto[]): { rows: SettlePreviewRow[]; leftOver: Decimal } {
  const bills = items.filter((i) => dec(i.owed).gt(0));
  const key = (i: OpenItemDto) => `${i.dueDate ?? i.date}|${i.date}|${i.number ?? ""}|${i.itemId}`;
  const sorted = [...bills].sort((a, b) => key(a).localeCompare(key(b)));
  // settleOldestFirst sorts by `date`; giving it the full sort key keeps the API's order.
  const { allocations, leftOver } = settleOldestFirst(covers.gt(0) ? covers : 0, sorted.map((i) => ({ id: `${i.itemType}|${i.itemId}`, open: i.owed, date: key(i) })));
  const byId = new Map(allocations.map((a) => [a.id, a.amount]));
  return { rows: sorted.map((item) => ({ item, amount: byId.get(`${item.itemType}|${item.itemId}`) ?? new Decimal(0) })), leftOver };
}

/** Unpaid bills only, oldest first (for pickers). */
export function unpaidBills(items: OpenItemDto[]): OpenItemDto[] {
  return previewOldestFirst(new Decimal(0), items).rows.map((r) => r.item);
}

/** 1 April of the Indian financial year that contains a business date (YYYY-MM-DD); "" for "". */
export function fyStart(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
}

/** Sum of decimal strings. */
export function sum(values: (string | null | undefined)[]): Decimal {
  return values.reduce((s, v) => s.add(dec(v)), new Decimal(0));
}
