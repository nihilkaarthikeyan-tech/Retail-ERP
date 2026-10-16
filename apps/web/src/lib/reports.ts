// Copyright (c) 2026, Rademics. All rights reserved.
// Shapes, labels and small helpers for the reports and dashboards screens
// (module 9, plan 09). The shapes mirror apps/api/src/reports/*.service.ts.
// Money and quantities arrive as decimal strings and stay Decimal (rule 1);
// only the pixel position of a chart mark is ever a plain number.
import { type CurrentUser, Decimal, hasPermission, INDIA_TIME_ZONE, type PermissionKey } from "shared";
import { api } from "./api";
import { formatDate } from "./format";
import type { MenuArea } from "./menu";
import { downloadCsv, rupees, toCsv } from "./purchasing";
import { showQuantity } from "./stock";

// ---- Dashboards (GET /dashboards, GET /dashboards/:name) ----

export type DashboardName = "store" | "owner" | "purchasing" | "accounts";
export type FigureFormat = "money" | "count" | "percent" | "quantity";

export interface DashboardTile {
  key: string;
  label: string;
  value: string;
  format: FigureFormat | string;
  previous?: string | null;
  /** null = nothing in the previous period ("new"); missing = no comparison. */
  changePercent?: string | null;
  hint?: string;
}

export interface DashboardDto {
  dashboard: DashboardName;
  date: string;
  workedOutAt: string;
  tiles: DashboardTile[];
  charts: Record<string, unknown>;
}

export const DASHBOARD_LABELS: Record<DashboardName, string> = {
  store: "Store",
  owner: "Owner",
  purchasing: "Purchasing",
  accounts: "Accounts",
};

export const DASHBOARD_AREAS: Record<DashboardName, MenuArea> = {
  store: "sales",
  owner: "sales",
  purchasing: "purchase",
  accounts: "accounts",
};

/** Tiles where a rise is bad news (shown in the warning colour). */
export const UP_IS_BAD = new Set(["returns_today", "late_orders", "short_items", "below_reorder", "customers_overdue", "supplier_dues"]);

// ---- Formatting ----

function dec(value: string | null | undefined): Decimal | null {
  if (value == null || value === "") return null;
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

/** "15.34%" (or a dash when there is nothing to divide by). */
export function percentText(value: string | null | undefined): string {
  const d = dec(value);
  return d ? `${d.toFixed(2)}%` : "—";
}

/** A figure shown the way its format says: ₹ with Indian grouping, a count, a quantity or a percent. */
export function formatFigure(value: string | null | undefined, format: string): string {
  if (format === "money") return rupees(value);
  if (format === "percent") return percentText(value);
  if (format === "quantity") return showQuantity(value);
  const d = dec(value);
  return d ? d.toFixed(0) : "—";
}

/** "▲ 12.5%" style change, rounded to one place; null = new. */
export function changeParts(changePercent: string | null | undefined): { direction: "up" | "down" | "flat" | "new"; text: string } {
  const d = dec(changePercent);
  if (!d) return { direction: "new", text: "new" };
  if (d.isZero()) return { direction: "flat", text: "0%" };
  return { direction: d.isPositive() ? "up" : "down", text: `${d.abs().toDecimalPlaces(1).toString()}%` };
}

/** When a figure was worked out, in Indian time: "16 Oct 2026, 2:30 pm". */
export function formatWorkedOut(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: INDIA_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: INDIA_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date}, ${time}`;
}

/** Hints from the API carry raw amounts and ISO dates; show them the usual way. */
export function tidyHint(hint: string): string {
  return hint.replace(/₹(-?\d+(?:\.\d+)?)/g, (_, n: string) => rupees(n)).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d: string) => formatDate(d));
}

/** "Oct 2026" for "2026-10". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return month;
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "17 Sep" for "2026-09-17" (chart axes, where the year is plain from the title). */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type ValueKind = "money" | "count" | "quantity" | "percent";

/** Short axis labels with Indian units: ₹950, ₹12.5K, ₹1.2L, ₹3.4Cr. */
export function compactValue(value: Decimal, kind: ValueKind): string {
  const negative = value.isNegative() && !value.isZero();
  const a = value.abs();
  const one = (d: Decimal) => d.toDecimalPlaces(1).toString();
  let text: string;
  if (kind === "percent") text = one(a);
  else if (a.gte(10_000_000)) text = `${one(a.div(10_000_000))}Cr`;
  else if (a.gte(100_000)) text = `${one(a.div(100_000))}L`;
  else if (a.gte(1_000)) text = `${one(a.div(1_000))}K`;
  else text = kind === "money" ? a.toDecimalPlaces(0).toString() : one(a);
  return `${negative ? "−" : ""}${kind === "money" ? "₹" : ""}${text}${kind === "percent" ? "%" : ""}`;
}

/** A value in full for tooltips and tables. */
export function fullValue(value: string | null | undefined, kind: ValueKind): string {
  return formatFigure(value, kind);
}

/** Round axis bounds and ticks around the data (always including zero). */
export function niceScale(min: Decimal, max: Decimal, kind: ValueKind, count = 4): { lo: Decimal; hi: Decimal; ticks: Decimal[] } {
  let lo = Decimal.min(min, 0);
  let hi = Decimal.max(max, 0);
  if (hi.eq(lo)) hi = lo.add(kind === "money" ? 100 : 1);
  const rough = hi.sub(lo).div(count);
  const magnitude = Decimal.pow(10, Decimal.log10(rough).floor());
  const n = rough.div(magnitude);
  let step = magnitude.mul(n.lte(1) ? 1 : n.lte(2) ? 2 : n.lte(2.5) ? 2.5 : n.lte(5) ? 5 : 10);
  if (kind === "count" && step.lt(1)) step = new Decimal(1);
  lo = lo.div(step).floor().mul(step);
  hi = hi.div(step).ceil().mul(step);
  const ticks: Decimal[] = [];
  for (let t = lo; t.lte(hi); t = t.add(step)) ticks.push(t);
  return { lo, hi, ticks };
}

/** Where a value sits between lo and hi, as a fraction for drawing (0 at lo, 1 at hi). */
export function fraction(value: Decimal, lo: Decimal, hi: Decimal): number {
  const span = hi.sub(lo);
  if (span.isZero()) return 0;
  return value.sub(lo).div(span).toNumber();
}

// ---- Downloads ----

export type CsvCell = string | number | null | undefined;
export type LogFilters = Record<string, string | number | boolean | null>;

/**
 * Downloads the CSV, then records the download in the history
 * (POST /reports/export-log). A failure to record never blocks the download.
 */
export async function downloadReport(fileName: string, headers: string[], rows: CsvCell[][], log: { report: string; filters: LogFilters; rows: number }): Promise<void> {
  downloadCsv(fileName, toCsv(headers, rows));
  try {
    await api.post("/reports/export-log", log);
  } catch {
    // Recording is best effort; the file has already been saved.
  }
}

// ---- The report centre ----

export type ReportFrequency = "daily" | "weekly" | "monthly";

export interface ReportEntry {
  id: string;
  title: string;
  /** The one question the report answers. */
  question: string;
  href: string;
  frequency: ReportFrequency;
  area: MenuArea;
  /** Where an older report lives (shown as a small note); absent for the module 9 reports. */
  where?: string;
  /** Any of these rights shows the report. */
  anyOf: PermissionKey[];
  /** All of these are needed as well. */
  allOf?: PermissionKey[];
}

const pos = (tab: string) => `/pos/reports?tab=${tab}`;
const purchases = (tab: string) => `/purchases/reports?tab=${tab}`;
const accounts = (tab: string) => `/accounts/reports?tab=${tab}`;
const ACCOUNTS_VIEW: PermissionKey[] = ["accounts.view"];
const COST: PermissionKey[] = ["cost_price.view", "stock.cost.view"];

export const REPORTS: ReportEntry[] = [
  // ---- Daily ----
  { id: "daily-sales", title: "Daily sales by store", question: "How did each store do? Bills, quantity, net sales, GST, discounts, returns and average bill.", href: "/reports/daily-sales", frequency: "daily", area: "sales", anyOf: ["pos.reports"] },
  { id: "returns", title: "Returns and cancelled bills", question: "What came back or was cancelled, with the reason and the cashier.", href: "/reports/returns", frequency: "daily", area: "sales", anyOf: ["pos.reports"] },
  { id: "discounts", title: "Discounts given", question: "Line and bill discounts, offers, coupons and price changes, and who gave or approved them.", href: "/reports/discounts", frequency: "daily", area: "sales", anyOf: ["pos.reports"] },
  { id: "cash-position", title: "Cash and bank position", question: "How much is in each cash, till and bank account on a date.", href: "/reports/cash-position", frequency: "daily", area: "accounts", anyOf: ACCOUNTS_VIEW },
  { id: "till-register", title: "Till register", question: "Every till bill with its payments.", href: pos("register"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-payments", title: "Payments by method", question: "How much came in as cash, card, UPI and so on.", href: pos("payments"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-hourly", title: "Hourly sales", question: "Which hours of the day are busiest.", href: pos("hourly"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-cashier", title: "Sales per cashier", question: "How much each cashier billed, and their returns.", href: pos("by-cashier"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-shifts", title: "Shifts", question: "Each shift's sales, returns and the difference found when the cash was counted.", href: pos("shifts"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-offline", title: "Offline bills to check", question: "Bills made while a till was offline that need a second look.", href: pos("offline-check"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "till-sync", title: "Till sync problems", question: "Bills a till sent that the server could not save.", href: pos("sync-problems"), frequency: "daily", area: "sales", where: "Till reports", anyOf: ["pos.reports"] },
  { id: "stock-on-hand", title: "Stock on hand", question: "How much of each item is in each store right now.", href: "/stock", frequency: "daily", area: "stock", where: "Inventory", anyOf: ["stock.view"] },
  { id: "negative-stock", title: "Negative stock", question: "Items sold beyond the stock the system knew about.", href: "/stock/exceptions", frequency: "daily", area: "stock", where: "Inventory", anyOf: ["stock.view"] },
  { id: "in-transit", title: "Goods in transit", question: "Stock sent from one store that has not been received at the other yet.", href: "/stock/transfers", frequency: "daily", area: "stock", where: "Inventory", anyOf: ["stock.view"] },
  { id: "order-follow-up", title: "Purchase order follow-up", question: "Which ordered goods are still to come, and which are late.", href: purchases("order-follow-up"), frequency: "daily", area: "purchase", where: "Purchase reports", anyOf: ["purchase.view"] },
  { id: "day-book", title: "Day book", question: "Every accounts entry of a day, in order.", href: accounts("day-book"), frequency: "daily", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },

  // ---- Weekly ----
  { id: "item-sales", title: "Item-wise sales", question: "What sold, by item, group or brand, with quantity and value.", href: "/reports/item-sales", frequency: "weekly", area: "sales", anyOf: ["pos.reports"] },
  { id: "best-sellers", title: "Best and worst sellers", question: "The top and bottom items by quantity, sales or margin.", href: "/reports/best-sellers", frequency: "weekly", area: "sales", anyOf: ["pos.reports"] },
  { id: "sales-by-group", title: "Sales by group or brand", question: "Which item groups or brands sell, week by week.", href: "/reports/sales-by-group", frequency: "weekly", area: "sales", anyOf: ["pos.reports"] },
  { id: "stock-cover", title: "Stock cover and sell-through", question: "How many days of stock are left at the current rate of sale, and how much of what came in has sold.", href: "/reports/stock-cover", frequency: "weekly", area: "stock", anyOf: ["stock.view"] },
  { id: "stock-history", title: "Stock history", question: "Every stock movement of an item, with the balance after each.", href: "/stock/ledger", frequency: "weekly", area: "stock", where: "Inventory", anyOf: ["stock.view"] },
  { id: "batches", title: "Batches and expiry", question: "Stock by batch, with expiry dates.", href: "/stock/batches", frequency: "weekly", area: "stock", where: "Inventory", anyOf: ["stock.view"] },
  { id: "reorder", title: "Reorder suggestions", question: "Which items are at or below their reorder level and how many to order.", href: "/purchases/reorder", frequency: "weekly", area: "purchase", where: "Purchases", anyOf: ["purchase.view"] },
  { id: "received-not-billed", title: "Goods received not billed", question: "Goods that came in but have no supplier bill yet.", href: purchases("received-not-billed"), frequency: "weekly", area: "purchase", where: "Purchase reports", anyOf: ["purchase.view"] },
  { id: "statement", title: "Customer or supplier statement", question: "Everything with one customer or supplier, and what is still owed.", href: accounts("statement"), frequency: "weekly", area: "accounts", where: "Accounts reports", anyOf: ["accounts.view", "payments.post"] },
  { id: "ageing", title: "Ageing of dues", question: "Who owes what, and how long it has been owed.", href: accounts("ageing"), frequency: "weekly", area: "accounts", where: "Accounts reports", anyOf: ["accounts.view", "payments.post"] },

  // ---- Monthly ----
  { id: "gross-profit", title: "Gross profit", question: "Sales, cost and margin by item, group, brand, customer or store.", href: "/reports/gross-profit", frequency: "monthly", area: "sales", anyOf: COST },
  { id: "stock-movement", title: "Stock movement for a period", question: "Opening, in, out and closing quantity and value per item.", href: "/reports/stock-movement", frequency: "monthly", area: "stock", anyOf: ["stock.view"] },
  { id: "stock-age", title: "Stock age", question: "How long the stock on hand has been sitting, in age bands.", href: "/reports/stock-age", frequency: "monthly", area: "stock", anyOf: ["stock.view"] },
  { id: "shrinkage", title: "Stock variance and loss", question: "Write-offs and count shortfalls by reason, as value and as % of sales.", href: "/reports/shrinkage", frequency: "monthly", area: "stock", anyOf: COST },
  { id: "cash-flow", title: "Cash flow", question: "Money in and out, from trading, investing and financing.", href: "/reports/cash-flow", frequency: "monthly", area: "accounts", anyOf: ACCOUNTS_VIEW },
  { id: "purchase-register", title: "Purchase register", question: "Every supplier bill line with GST.", href: purchases("register"), frequency: "monthly", area: "purchase", where: "Purchase reports", anyOf: ["purchase.view"], allOf: ["buying_prices.view"] },
  { id: "purchases-by-supplier", title: "Purchases by supplier", question: "How much was bought from each supplier.", href: purchases("by-supplier"), frequency: "monthly", area: "purchase", where: "Purchase reports", anyOf: ["purchase.view"], allOf: ["buying_prices.view"] },
  { id: "purchases-by-item", title: "Purchases by item", question: "How much of each item was bought, and at what average rate.", href: purchases("by-item"), frequency: "monthly", area: "purchase", where: "Purchase reports", anyOf: ["purchase.view"], allOf: ["buying_prices.view"] },
  { id: "general-ledger", title: "General ledger", question: "Every entry in an account, with the running balance.", href: accounts("general-ledger"), frequency: "monthly", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },
  { id: "trial-balance", title: "Trial balance", question: "The balance of every account, with debits equal to credits.", href: accounts("trial-balance"), frequency: "monthly", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },
  { id: "profit-and-loss", title: "Profit and loss", question: "Income less expenses: did the shop make money?", href: accounts("profit-and-loss"), frequency: "monthly", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },
  { id: "balance-sheet", title: "Balance sheet", question: "What the shop owns and owes on a date.", href: accounts("balance-sheet"), frequency: "monthly", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },
  { id: "stock-vs-accounts", title: "Stock against accounts", question: "Does the stock value agree with the stock accounts?", href: accounts("stock-vs-accounts"), frequency: "monthly", area: "accounts", where: "Accounts reports", anyOf: ACCOUNTS_VIEW },
];

export const FREQUENCY_LABELS: Record<ReportFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export function canSeeReport(user: CurrentUser | null, entry: Pick<ReportEntry, "anyOf" | "allOf">): boolean {
  return entry.anyOf.some((k) => hasPermission(user, k)) && (entry.allOf ?? []).every((k) => hasPermission(user, k));
}

export function visibleReports(user: CurrentUser | null): ReportEntry[] {
  return REPORTS.filter((r) => canSeeReport(user, r));
}

/** The report centre entry for a module 9 report page (title and question). */
export function reportEntry(id: string): ReportEntry {
  const found = REPORTS.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown report ${id}`);
  return found;
}

// ---- Report response shapes ----

export interface SalesTotals {
  saleBills: number;
  returnBills: number;
  quantity: string;
  grossSales: string;
  returns: string;
  netSales: string;
  tax: string;
  discounts: string;
  averageBill: string;
  itemsPerBill: string;
  /** Only for users who may see cost (decision 70). */
  cost?: string;
  grossProfit?: string;
  marginPercent?: string | null;
}

export interface DailySalesRow extends SalesTotals {
  date: string;
  storeId: string;
  store: string;
}

export interface DailySalesDto {
  from: string;
  to: string;
  workedOutAt: string;
  rows: DailySalesRow[];
  totals: SalesTotals;
}

export type GroupBy = "item" | "group" | "brand" | "customer" | "store" | "cashier";

export interface GroupedRow extends SalesTotals {
  key: string;
  code: string | null;
  name: string;
  rank?: number;
}

export interface GroupedSalesDto {
  from: string;
  to: string;
  groupBy: GroupBy;
  workedOutAt: string;
  rows: GroupedRow[];
  totals: SalesTotals;
  seesCost: boolean;
  rankBy?: "quantity" | "sales" | "margin";
  worst?: boolean;
}

export interface SalesByGroupDto {
  from: string;
  to: string;
  groupBy: "group" | "brand";
  weeks: string[];
  workedOutAt: string;
  rows: { key: string; code: string | null; name: string; weeks: Record<string, { netSales: string; quantity: string }>; netSales: string; quantity: string }[];
}

export interface ReturnsRow {
  billId: string;
  number: string;
  date: string | null;
  store: string | null;
  till: string;
  what: string;
  originalBill: string | null;
  items: string;
  value: string;
  reason: string | null;
  cashier: string | null;
  approvedBy: string | null;
  cancelledBy: string | null;
}

export interface ReturnsDto {
  from: string;
  to: string;
  workedOutAt: string;
  rows: ReturnsRow[];
  totals: { returns: string; count: number };
}

export interface DiscountRow {
  billId: string;
  number: string;
  date: string | null;
  item: string;
  quantity: string;
  listPrice: string;
  price: string;
  priceChange: string;
  discountPercent: string;
  lineAndBillDiscount: string;
  offerDiscount: string;
  offer: string | null;
  coupon: string | null;
  cashier: string | null;
  approvedBy: string | null;
}

export interface DiscountsDto {
  from: string;
  to: string;
  workedOutAt: string;
  rows: DiscountRow[];
  totals: { lineAndBillDiscounts: string; ofWhichBillDiscounts: string; offers: string; priceChanges: string; all: string };
}

export interface StockMovementRow {
  itemId: string;
  code: string | null;
  name: string;
  unit: string | null;
  openingQuantity: string;
  inQuantity: string;
  outQuantity: string;
  closingQuantity: string;
  openingValue?: string;
  inValue?: string;
  outValue?: string;
  closingValue?: string;
}

export interface StockMovementDto {
  from: string;
  to: string;
  workedOutAt: string;
  rows: StockMovementRow[];
  totals: { openingValue?: string; inValue?: string; outValue?: string; closingValue?: string; turnover?: string | null };
}

export interface StockCoverRow {
  itemId: string;
  code: string | null;
  name: string;
  unit: string | null;
  onHand: string;
  sold: string;
  perDay: string;
  daysLeft: string | null;
  opening: string;
  cameIn: string;
  sellThroughPercent: string | null;
}

export interface StockCoverDto {
  from: string;
  to: string;
  days: number;
  workedOutAt: string;
  rows: StockCoverRow[];
}

export interface StockAgeDto {
  asOf: string;
  labels: string[];
  workedOutAt: string;
  rows: { itemId: string; code: string | null; name: string; unit: string | null; onHand: string; value?: string; bands: Record<string, { quantity: string; value?: string }> }[];
  totals: Record<string, { quantity: string; value?: string }>;
}

export interface ShrinkageDto {
  from: string;
  to: string;
  workedOutAt: string;
  byReason: { reason: string; quantity: string; value: string }[];
  rows: { documentId: string; number: string; date: string | null; reason: string; item: string; quantity: string; value: string }[];
  totals: { loss: string; netSales: string; shrinkagePercent: string | null };
}

export interface CashPositionDto {
  asOf: string;
  workedOutAt: string;
  rows: { accountId: string; number: string | null; name: string; kind: string; store: string | null; balance: string }[];
  total: string;
}

export interface CashFlowSection {
  rows: { accountId: string; name: string; amount: string }[];
  total: string;
}

export interface CashFlowDto {
  from: string;
  to: string;
  workedOutAt: string;
  opening: string;
  trading: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  transfers: CashFlowSection;
  netChange: string;
  closing: string;
  agrees: boolean;
}

// ---- Daily summary email ----

export interface SummaryEmailSettingsDto {
  enabled: boolean;
  sendAt: string;
  recipientIds: string[];
  figures: string[];
  mail: { configured: boolean; account: string };
  figureLabels: Record<string, string>;
}

export interface SummaryEmailRunDto {
  id: string;
  businessDate: string | null;
  kind: "scheduled" | "test" | string;
  startedAt: string;
  sentAt: string | null;
  recipients: string[];
  error: string | null;
}
