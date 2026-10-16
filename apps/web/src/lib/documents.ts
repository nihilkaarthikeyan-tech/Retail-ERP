// Copyright (c) 2026, Rademics. All rights reserved.
// Module 10 on the web: printed documents, labels, import and export, going
// live. The shapes the API sends, plain-language names, and the small pieces
// of arithmetic the screens need (barcode bars, label sheets). Money is never
// turned into a floating-point number here (rule 1): amounts stay strings.
import { type ImportKind, type ImportMode, type LabelField, labelsPerSheet, type LabelSize, type PrintKind } from "shared";
import { formatDate } from "./format";
import { rupees } from "./purchasing";
import { groupIndian } from "./till/format";

// ---- Printed documents (GET /print/:kind/:id) ----

export interface PrintColumnDto {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface PrintDocumentDto {
  kind: PrintKind;
  title: string;
  number: string | null;
  date: string | null;
  mark: "DRAFT" | "CANCELLED" | null;
  paper: "A4" | "A5";
  letterhead: { name: string; legalName: string; storeName: string | null; address: string[]; gstin: string | null; phone: string | null; email: string | null; showLogo: boolean };
  party: { label: string; name: string; code: string | null; address: string[]; gstin: string | null; phone: string | null } | null;
  details: [string, string][];
  columns: PrintColumnDto[];
  lines: Record<string, string>[];
  totals: [string, string][];
  amountInWords: string | null;
  terms: string[];
  signatures: string[];
  printedAt: string;
}

export const PRINT_KIND_LABELS: Record<PrintKind, string> = {
  purchase_order: "Purchase order",
  goods_receipt: "Goods receipt note",
  transfer: "Stock transfer slip",
  count_sheet: "Stock count sheet",
  payment: "Payment receipt or voucher",
  journal: "Journal voucher",
  statement: "Statement of account",
};

/** Where a document's print page is. A statement's id is "customer:<id>" or "supplier:<id>". */
export function printHref(kind: PrintKind, id: string): string {
  return `/print/${kind}/${id}`;
}

const MONEY = /^-?\d+\.\d{2}$/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** "123456.50" as "1,23,456.50" (Indian grouping, no rupee sign; minus as "−"). */
export function groupedAmount(value: string): string {
  const negative = value.startsWith("-");
  const [whole, frac] = value.replace(/^-/, "").split(".");
  return `${negative && /[1-9]/.test(value) ? "−" : ""}${groupIndian(whole)}.${frac}`;
}

/** A printed cell: amounts with Indian grouping, dates as "16 Oct 2026"; anything else as sent. */
export function printCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (MONEY.test(value)) return groupedAmount(value);
  return value.replace(ISO_DATE, (d) => formatDate(d));
}

/** A printed total or detail: amounts in rupees ("₹1,23,456.50"), dates as "16 Oct 2026". */
export function printAmount(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (MONEY.test(value)) return rupees(value);
  return printCell(value);
}

// ---- Settings and standard terms ----

export interface PrintSettingsDto {
  paperSize: "A4" | "A5";
  showLogo: boolean;
  storeLetterhead: boolean;
  hasLogo: boolean;
}

export type TermsUse = "selling" | "buying" | "both";

export interface TermsDto {
  id: string;
  title: string;
  text: string;
  usedFor: TermsUse;
  defaultFor: PrintKind[];
  active: boolean;
}

export const TERMS_USE_LABELS: Record<TermsUse, string> = { selling: "Selling", buying: "Buying", both: "Selling and buying" };

/** The largest logo the API takes (POST /print/logo). */
export const LOGO_MAX_BYTES = 300_000;
export const LOGO_TYPES = ["image/png", "image/jpeg"];

/** Why a chosen logo file cannot be used, or null when it is fine. */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "The logo must be a PNG or JPEG picture.";
  if (file.size > LOGO_MAX_BYTES) return `The logo must be smaller than 300 KB; this one is ${Math.ceil(file.size / 1000)} KB.`;
  return null;
}

// ---- Labels ----

export interface LabelTemplateDto {
  id: string;
  name: string;
  sizeKey: string;
  /** Millimetres. */
  width: number;
  height: number;
  media: "sheet" | "roll";
  across: number | null;
  down: number | null;
  marginTop: number | null;
  marginLeft: number | null;
  gapX: number | null;
  gapY: number | null;
  fields: LabelField[];
  fontSize: number;
  isDefault: boolean;
}

export interface LabelTemplatesDto {
  sizes: LabelSize[];
  templates: LabelTemplateDto[];
}

export interface BarcodeDto {
  symbology: "EAN13" | "EAN8" | "CODE128";
  /** "1" is a bar, "0" a space, one character per module. */
  modules: string;
  text: string;
}

export interface LabelDto {
  itemId: string;
  code: string;
  name: string;
  unit: string | null;
  price: string | null;
  /** Plan 11 C5: on a markdown's labels, the price before the markdown. */
  wasPrice?: string | null;
  mrp: string | null;
  barcode: BarcodeDto | null;
  batch: string | null;
  expiry: string | null;
  packed: string | null;
  store: string | null;
}

export interface LabelDataDto {
  template: LabelTemplateDto;
  labels: LabelDto[];
}

export const LABEL_FIELD_LABELS: Record<LabelField, string> = {
  name: "Item name",
  price: "Selling price",
  mrp: "MRP",
  barcode: "Barcode",
  code: "Item code",
  unit: "Unit",
  batch: "Batch",
  expiry: "Expiry date",
  packed: "Packed on",
  store: "Store name",
};

/** Where labels sit on an A4 sheet (millimetres). */
export interface SheetLayout {
  across: number;
  down: number;
  perSheet: number;
  marginTop: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
}

/** The sheet layout of a template: the standard sheet's own figures, or as many as fit for a custom size. */
export function sheetLayout(t: Pick<LabelTemplateDto, "width" | "height" | "across" | "down" | "marginTop" | "marginLeft" | "gapX" | "gapY">): SheetLayout {
  if (t.across && t.down) {
    return { across: t.across, down: t.down, perSheet: t.across * t.down, marginTop: t.marginTop ?? 0, marginLeft: t.marginLeft ?? 0, gapX: t.gapX ?? 0, gapY: t.gapY ?? 0 };
  }
  // Custom sizes use the same margins as labelsPerSheet's defaults.
  const fit = labelsPerSheet({ width: t.width, height: t.height });
  return { ...fit, marginTop: 10, marginLeft: 5, gapX: 0, gapY: 0 };
}

/** Labels split into sheets; `skip` leaves the first spaces of the first sheet empty (a part-used sheet). */
export function sheetsOf<T>(labels: T[], perSheet: number, skip = 0): (T | null)[][] {
  if (perSheet < 1) return [];
  const slots: (T | null)[] = [...Array<null>(Math.max(0, Math.min(skip, perSheet - 1))).fill(null), ...labels];
  const sheets: (T | null)[][] = [];
  for (let i = 0; i < slots.length; i += perSheet) sheets.push(slots.slice(i, i + perSheet));
  return sheets;
}

// ---- Barcodes (drawn from the API's modules) ----

export interface BarRun {
  /** Start, in modules from the left edge of the bars. */
  x: number;
  width: number;
  /** EAN guard bars, drawn longer than the others. */
  guard: boolean;
}

/** EAN guard patterns (start, centre, end) as [first, last] module positions. */
function guardsOf(symbology: BarcodeDto["symbology"], length: number): [number, number][] {
  if (symbology === "EAN13" && length === 95) return [[0, 2], [45, 49], [92, 94]];
  if (symbology === "EAN8" && length === 67) return [[0, 2], [31, 35], [64, 66]];
  return [];
}

/** Each run of "1"s becomes one bar. */
export function barRuns(modules: string, symbology: BarcodeDto["symbology"] = "CODE128"): BarRun[] {
  const guards = guardsOf(symbology, modules.length);
  const runs: BarRun[] = [];
  let start = -1;
  for (let i = 0; i <= modules.length; i++) {
    const bar = modules[i] === "1";
    if (bar && start < 0) start = i;
    if (!bar && start >= 0) {
      runs.push({ x: start, width: i - start, guard: guards.some(([a, b]) => start >= a && i - 1 <= b) });
      start = -1;
    }
  }
  return runs;
}

/** Empty margins either side of the bars that scanners need (in modules). */
export function quietZones(symbology: BarcodeDto["symbology"]): { left: number; right: number } {
  if (symbology === "EAN13") return { left: 11, right: 7 };
  if (symbology === "EAN8") return { left: 7, right: 7 };
  return { left: 10, right: 10 };
}

/**
 * The human-readable digits of an EAN barcode, each with its centre (in
 * modules from the left edge of the bars): EAN-13 puts its first digit in the
 * left margin and six digits under each half; EAN-8 four under each half.
 */
export function eanDigits(b: BarcodeDto): { x: number; ch: string }[] | null {
  if (b.symbology === "EAN13" && b.modules.length === 95) {
    const digits = b.text.length === 12 ? `0${b.text}` : b.text;
    if (!/^\d{13}$/.test(digits)) return null;
    return [...digits].map((ch, i) => ({ ch, x: i === 0 ? -5 : i <= 6 ? 3 + (i - 1) * 7 + 3.5 : 50 + (i - 7) * 7 + 3.5 }));
  }
  if (b.symbology === "EAN8" && b.modules.length === 67) {
    if (!/^\d{8}$/.test(b.text)) return null;
    return [...b.text].map((ch, i) => ({ ch, x: i < 4 ? 3 + i * 7 + 3.5 : 36 + (i - 4) * 7 + 3.5 }));
  }
  return null;
}

// ---- Import (GET /imports/kinds, POST /imports/preview, GET /imports/:id) ----

export interface ImportFieldDto {
  key: string;
  label: string;
  type: "text" | "code" | "number" | "date" | "daymonth" | "yesno";
  required?: boolean;
  aliases?: string[];
  digitsLength?: number[];
  hint?: string;
}

export interface ImportKindDto {
  kind: ImportKind;
  label: string;
  fields: ImportFieldDto[];
  exportable: boolean;
}

export interface ImportPreviewDto {
  jobId: string;
  kind: ImportKind;
  mode: ImportMode;
  fileName: string;
  columns: { heading: string | null; field: string | null; label: string | null }[];
  unmatched: string[];
  missingRequired: string[];
  rows: number;
  ready: number;
  problems: { rowNumber: number; problems: string[] }[];
  fields: ImportFieldDto[];
}

export type ImportJobStatus = "previewed" | "running" | "done" | "partly_done" | "failed";

export interface ImportJobDto {
  id: string;
  kind: ImportKind;
  kindLabel: string;
  mode: ImportMode;
  fileName: string;
  status: ImportJobStatus;
  totalRows: number;
  added: number;
  changed: number;
  unchanged: number;
  failed: number;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportStatusDto extends ImportJobDto {
  /** Rows finished so far (saved, unchanged or failed). */
  done: number;
  failedRows: { rowNumber: number; message: string | null }[];
}

export const IMPORT_MODE_LABELS: Record<ImportMode, { label: string; explain: string }> = {
  add: { label: "Add new only", explain: "Rows for records that already exist are left alone." },
  change: { label: "Change existing only", explain: "Only records that already exist are changed; only the columns in your file are changed." },
  add_or_change: { label: "Add new and change existing", explain: "New records are added and existing ones are brought up to date." },
};

export const IMPORT_STATUS_LABELS: Record<ImportJobStatus, string> = {
  previewed: "Checked, not imported",
  running: "Importing",
  done: "Done",
  partly_done: "Partly done",
  failed: "Failed",
};

export function importStatusTone(status: ImportJobStatus): "ok" | "warn" | "off" | "neutral" {
  if (status === "done") return "ok";
  if (status === "failed") return "off";
  if (status === "partly_done" || status === "running") return "warn";
  return "neutral";
}

/** Download names used when the browser cannot read the server's own file name. */
export const importFileNames = {
  template: (kind: string) => `${kind}-template.xlsx`,
  failedRows: (kind: string) => `${kind}-failed-rows.xlsx`,
  export: (kind: string, format: "xlsx" | "csv") => `${kind}.${format}`,
};

// ---- Going live (GET /go-live) ----

export interface ClearingStepDto {
  step: string;
  rows: number;
  outcome: string;
}

export interface GoLiveDto {
  goLiveDate: string | null;
  clearingAllowed: boolean;
  /** The company's legal name, typed in full to confirm. */
  companyName: string;
  transactions: Record<string, number>;
  clearings: { id: string; reason: string; requestedAt: string; finishedAt: string | null; steps: ClearingStepDto[] }[];
  check: {
    asOf: string;
    trialBalance: Record<string, string>;
    stockAgainstAccounts: { rows: { key: string; name: string; stockValue: string; accounts: string; difference: string }[]; ok: boolean };
    customerDues: Record<string, string>;
    supplierDues: Record<string, string>;
  };
}

export interface ClearResultDto {
  id: string;
  steps: ClearingStepDto[];
  note: string;
}

export const TRANSACTION_COUNT_LABELS: Record<string, string> = {
  bills: "Till bills",
  stockMovements: "Stock movements",
  ledgerEntries: "Ledger entries",
  purchaseDocuments: "Goods receipts",
};

/** The typed company name matches (spaces at the ends and capital letters do not matter). */
export function companyNameMatches(typed: string, companyName: string): boolean {
  const t = typed.trim().toLowerCase();
  return t !== "" && t === companyName.trim().toLowerCase();
}

/** The print of a stock document: transfers and moves print a transfer slip, counts a count sheet; others have none. */
export function stockPrintKind(kind: string): "transfer" | "count_sheet" | null {
  if (kind === "transfer_send" || kind === "transfer_receive" || kind === "move") return "transfer";
  if (kind === "count") return "count_sheet";
  return null;
}
