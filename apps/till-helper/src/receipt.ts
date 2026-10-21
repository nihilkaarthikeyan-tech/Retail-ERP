// Copyright (c) 2026, Rademics. All rights reserved.
// The receipt the till page sends (already calculated and confirmed by the
// ERP), a check of its shape, and how it is laid out on 80 mm / 58 mm paper.
// The helper never calculates money: every amount is printed as received.
import { EscPos } from './escpos.js';
import { cellLeft, cellRight, leftRight, wrap } from './text.js';

/** Amounts arrive as decimal strings ("372.00"); plain numbers are accepted too. */
export type Amount = string | number;

export interface ReceiptLine {
  name: string;
  code?: string | null;
  hsn?: string | null;
  quantity: Amount;
  price: Amount;
  discount?: Amount | null;
  amount: Amount;
  free?: boolean;
  serials?: string[];
}

export interface GstRow {
  rate: Amount;
  taxable: Amount;
  cgst?: Amount | null;
  sgst?: Amount | null;
  igst?: Amount | null;
}

export interface Payment {
  method: string;
  amount: Amount;
  reference?: string | null;
}

/** Plan 08 (CBIC invoice rules): what the receipt prints about GST, as the ERP sends it. */
export interface ReceiptGst {
  title: string;
  invoiceKind?: string | null;
  sellerGstin?: string | null;
  buyer?: { name?: string | null; gstin?: string | null; address?: string | null; state?: { code: string; name: string } | null } | null;
  placeOfSupply?: { code: string; name: string } | null;
  reverseCharge?: boolean;
  original?: { number: string; date?: string | null } | null;
  declaration?: string | null;
  creditNoteLate?: boolean;
}

export interface Receipt {
  number: string;
  kind: 'sale' | 'return';
  duplicate?: boolean;
  provisional?: boolean;
  soldAt: string;
  till?: string | null;
  footer?: string | null;
  lines: ReceiptLine[];
  gstTable?: GstRow[];
  totals: { gross?: Amount; discount?: Amount; taxable?: Amount; rounding?: Amount; total: Amount };
  payments?: Payment[];
  change?: Amount | null;
  store: { name: string; address?: string | null; phone?: string | null };
  company: { legalName?: string | null; gstin?: string | null };
  /** Optional extras the till may send. */
  cashier?: string | null;
  customer?: string | null;
  /** Plan 08: title, buyer, place of supply, original bill and declaration. */
  gst?: ReceiptGst | null;
}

export type PaperWidth = 80 | 58;

/** Characters per line in the printer's normal font. */
export function columnsFor(paper: PaperWidth): number {
  return paper === 58 ? 32 : 48;
}

export const PROVISIONAL_NOTE = 'GST rates not yet approved — test bill';

// ---------------------------------------------------------------------------
// Shape check (the helper is reachable only from the till page, but a bad
// request must give a clear error instead of a half-printed receipt).

const MAX_TEXT = 500;
const MAX_LINES = 1000;

type Check = { ok: true; receipt: Receipt } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_TEXT;
}
function isOptText(v: unknown): boolean {
  return v === undefined || v === null || isText(v);
}
function isAmount(v: unknown): v is Amount {
  return (typeof v === 'string' && v.length <= 40 && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
}
function isOptAmount(v: unknown): boolean {
  return v === undefined || v === null || isAmount(v);
}

export function checkReceipt(input: unknown): Check {
  const fail = (error: string): Check => ({ ok: false, error });
  if (!isObj(input)) return fail('receipt must be an object');
  const r = input;
  if (!isText(r.number) || !r.number) return fail('receipt.number is required');
  if (r.kind !== 'sale' && r.kind !== 'return') return fail("receipt.kind must be 'sale' or 'return'");
  if (!isText(r.soldAt)) return fail('receipt.soldAt is required');
  if (!isOptText(r.till) || !isOptText(r.footer)) return fail('receipt.till and receipt.footer must be text');
  if (!isOptText(r.cashier) || !isOptText(r.customer)) return fail('receipt.cashier and receipt.customer must be text');
  if (r.duplicate !== undefined && typeof r.duplicate !== 'boolean') return fail('receipt.duplicate must be true or false');
  if (r.provisional !== undefined && typeof r.provisional !== 'boolean') return fail('receipt.provisional must be true or false');

  if (!Array.isArray(r.lines) || r.lines.length > MAX_LINES) return fail('receipt.lines must be a list');
  for (const [i, l] of r.lines.entries()) {
    if (!isObj(l)) return fail(`receipt.lines[${i}] must be an object`);
    if (!isText(l.name)) return fail(`receipt.lines[${i}].name is required`);
    if (!isOptText(l.code) || !isOptText(l.hsn)) return fail(`receipt.lines[${i}].code/hsn must be text`);
    if (!isAmount(l.quantity) || !isAmount(l.price) || !isAmount(l.amount) || !isOptAmount(l.discount)) {
      return fail(`receipt.lines[${i}] quantity, price, discount and amount must be numbers`);
    }
    if (l.free !== undefined && typeof l.free !== 'boolean') return fail(`receipt.lines[${i}].free must be true or false`);
    if (l.serials !== undefined && (!Array.isArray(l.serials) || l.serials.length > MAX_LINES || !l.serials.every(isText))) {
      return fail(`receipt.lines[${i}].serials must be a list of text`);
    }
  }

  if (r.gstTable !== undefined) {
    if (!Array.isArray(r.gstTable) || r.gstTable.length > 50) return fail('receipt.gstTable must be a list');
    for (const [i, g] of r.gstTable.entries()) {
      if (!isObj(g) || !isAmount(g.rate) || !isAmount(g.taxable) || !isOptAmount(g.cgst) || !isOptAmount(g.sgst) || !isOptAmount(g.igst)) {
        return fail(`receipt.gstTable[${i}] must have rate, taxable, cgst, sgst, igst as numbers`);
      }
    }
  }

  if (!isObj(r.totals) || !isAmount(r.totals.total)) return fail('receipt.totals.total is required');
  for (const k of ['gross', 'discount', 'taxable', 'rounding'] as const) {
    if (!isOptAmount(r.totals[k])) return fail(`receipt.totals.${k} must be a number`);
  }

  if (r.payments !== undefined) {
    if (!Array.isArray(r.payments) || r.payments.length > 50) return fail('receipt.payments must be a list');
    for (const [i, p] of r.payments.entries()) {
      if (!isObj(p) || !isText(p.method) || !isAmount(p.amount) || !isOptText(p.reference)) {
        return fail(`receipt.payments[${i}] must have method and amount`);
      }
    }
  }
  if (!isOptAmount(r.change)) return fail('receipt.change must be a number');

  if (!isObj(r.store) || !isText(r.store.name)) return fail('receipt.store.name is required');
  if (!isOptText(r.store.address) || !isOptText(r.store.phone)) return fail('receipt.store address/phone must be text');
  if (!isObj(r.company) || !isOptText(r.company.legalName) || !isOptText(r.company.gstin)) {
    return fail('receipt.company must have legalName and gstin as text');
  }
  if (r.gst !== undefined && r.gst !== null) {
    const g = r.gst;
    const isState = (v: unknown) => v === undefined || v === null || (isObj(v) && isText(v.code) && isText(v.name));
    if (!isObj(g) || !isText(g.title) || !g.title) return fail('receipt.gst.title is required');
    if (!isOptText(g.invoiceKind) || !isOptText(g.sellerGstin) || !isOptText(g.declaration)) return fail('receipt.gst text fields must be text');
    if (!isState(g.placeOfSupply)) return fail('receipt.gst.placeOfSupply must have code and name');
    if (g.buyer !== undefined && g.buyer !== null && (!isObj(g.buyer) || !isOptText(g.buyer.name) || !isOptText(g.buyer.gstin) || !isOptText(g.buyer.address) || !isState(g.buyer.state))) {
      return fail('receipt.gst.buyer must have name, gstin, address and state as text');
    }
    if (g.original !== undefined && g.original !== null && (!isObj(g.original) || !isText(g.original.number) || !isOptText(g.original.date))) return fail('receipt.gst.original must have the bill number');
    for (const k of ['reverseCharge', 'creditNoteLate'] as const) {
      if (g[k] !== undefined && typeof g[k] !== 'boolean') return fail(`receipt.gst.${k} must be true or false`);
    }
  }
  return { ok: true, receipt: input as unknown as Receipt };
}

// ---------------------------------------------------------------------------
// Formatting (display only — no arithmetic on amounts).

/** Shows an amount as received; a plain number is shown with 2 decimals. */
export function showAmount(v: Amount | null | undefined): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? v.toFixed(2) : v.trim();
}

/** Shows a quantity as received ("2", "1.250"). */
function showQty(v: Amount): string {
  return typeof v === 'number' ? String(v) : v.trim();
}

/** True for "0", "0.00", "-0.00", 0 and empty values. */
export function isZero(v: Amount | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return v === 0;
  return /^[+-]?0*(\.0*)?$/.test(v.trim());
}

/** "5", "5.00" and 5 all show as "5%"; "12.5" shows as "12.5%". */
function showRate(v: Amount): string {
  let s = typeof v === 'number' ? String(v) : v.trim();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s + '%';
}

function rs(v: Amount | null | undefined): string {
  return 'Rs. ' + showAmount(v);
}

/** Bill date and time in Indian time (Asia/Kolkata), e.g. "15-10-2026 10:30". */
export function indianDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}-${p('month')}-${p('year')} ${p('hour')}:${p('minute')}`;
}

// ---------------------------------------------------------------------------
// Layout.

function gstTableLines(rows: GstRow[], width: number): string[] {
  const hasIgst = rows.some((g) => !isZero(g.igst));
  const hasSplit = rows.some((g) => !isZero(g.cgst) || !isZero(g.sgst)) || !hasIgst;
  const cols: { title: string; get: (g: GstRow) => Amount | null | undefined }[] = [
    { title: 'Taxable', get: (g) => g.taxable },
  ];
  if (hasSplit) cols.push({ title: 'CGST', get: (g) => g.cgst ?? '0.00' }, { title: 'SGST', get: (g) => g.sgst ?? '0.00' });
  if (hasIgst) cols.push({ title: 'IGST', get: (g) => g.igst ?? '0.00' });

  const cellW = Math.floor((width - 5) / cols.length);
  const rateW = width - cellW * cols.length;

  const row = (first: string, cells: string[]): string | null => {
    const a = cellLeft(first, rateW - 1);
    if (a === null) return null;
    let out = a + ' ';
    for (const c of cells) {
      const cell = cellRight(c, cellW);
      if (cell === null) return null;
      out += cell;
    }
    return out;
  };

  const table: string[] = [];
  const header = row('GST', cols.map((c) => c.title));
  if (header !== null) {
    table.push(header);
    let fits = true;
    for (const g of rows) {
      const line = row(showRate(g.rate), cols.map((c) => showAmount(c.get(g))));
      if (line === null) {
        fits = false;
        break;
      }
      table.push(line);
    }
    if (fits) return table;
  }

  // Too narrow for columns: one short block per rate instead.
  const stacked: string[] = [];
  for (const g of rows) {
    stacked.push(...leftRight(`GST ${showRate(g.rate)} taxable`, showAmount(g.taxable), width));
    for (const c of cols.slice(1)) stacked.push(...leftRight(`  ${c.title}`, showAmount(c.get(g)), width));
  }
  return stacked;
}

/** Turns a receipt into ESC/POS bytes for the given paper width. */
export function buildReceipt(receipt: Receipt, paper: PaperWidth): Buffer {
  const w = columnsFor(paper);
  const p = new EscPos().init();
  const rule = '-'.repeat(w);
  const lines = (ls: string[]) => {
    for (const l of ls) p.line(l);
  };

  // Header: who is selling.
  p.align('centre').bold(true);
  lines(wrap(receipt.store.name, w));
  p.bold(false);
  const legal = receipt.company.legalName?.trim();
  if (legal && legal !== receipt.store.name.trim()) lines(wrap(legal, w));
  const g = receipt.gst ?? null;
  const sellerGstin = g?.sellerGstin ?? receipt.company.gstin;
  if (sellerGstin) lines(wrap(`GSTIN: ${sellerGstin}`, w));
  if (receipt.store.address) lines(wrap(receipt.store.address, w));
  if (receipt.store.phone) lines(wrap(`Phone: ${receipt.store.phone}`, w));

  // Title.
  p.line().bold(true);
  lines(wrap(g ? g.title.toUpperCase() : receipt.kind === 'return' ? 'CREDIT NOTE / RETURN' : 'TAX INVOICE', w));
  if (receipt.duplicate) lines(wrap('DUPLICATE', w));
  p.bold(false);
  if (g?.declaration) lines(wrap(g.declaration, w));
  if (receipt.provisional) lines(wrap(PROVISIONAL_NOTE, w));

  // Bill number, date and till.
  p.align('left');
  const numberLabel = receipt.kind === 'return' ? 'Credit note' : 'Bill';
  if (receipt.till) lines(leftRight(`${numberLabel}: ${receipt.number}`, `Till: ${receipt.till}`, w));
  else lines(wrap(`${numberLabel}: ${receipt.number}`, w));
  lines(wrap(`Date: ${indianDateTime(receipt.soldAt)}`, w));
  if (receipt.cashier) lines(wrap(`Cashier: ${receipt.cashier}`, w));
  if (receipt.customer) lines(wrap(`Customer: ${receipt.customer}`, w));
  if (g?.original) lines(wrap(`Against bill ${g.original.number}${g.original.date ? ` dated ${g.original.date}` : ''}`, w));
  if (g?.buyer) {
    if (g.buyer.name) lines(wrap(`Buyer: ${g.buyer.name}`, w));
    if (g.buyer.gstin) lines(wrap(`Buyer GSTIN: ${g.buyer.gstin}`, w));
    if (g.buyer.address) lines(wrap(g.buyer.address, w));
    if (g.buyer.state) lines(wrap(`State: ${g.buyer.state.name} (${g.buyer.state.code})`, w));
  }
  if (g?.placeOfSupply) lines(wrap(`Place of supply: ${g.placeOfSupply.name} (${g.placeOfSupply.code})`, w));
  if (g && g.invoiceKind === 'business') lines(wrap(`Reverse charge: ${g.reverseCharge ? 'Yes' : 'No'}`, w));

  // Items.
  p.line(rule);
  lines(leftRight('Item', 'Amount', w));
  p.line(rule);
  for (const l of receipt.lines) {
    lines(wrap(l.name, w));
    lines(leftRight(`  ${showQty(l.quantity)} x ${showAmount(l.price)}`, l.free ? 'FREE' : showAmount(l.amount), w));
    if (!isZero(l.discount)) {
      const d = showAmount(l.discount);
      lines(leftRight('  Discount', d.startsWith('-') ? d : `-${d}`, w));
    }
    const detail = [l.code ? `Code ${l.code}` : '', l.hsn ? `HSN ${l.hsn}` : ''].filter(Boolean).join(', ');
    if (detail) lines(wrap(detail, w - 2).map((x) => '  ' + x));
    if (l.serials && l.serials.length > 0) lines(wrap(`S/N: ${l.serials.join(', ')}`, w - 2).map((x) => '  ' + x));
  }
  p.line(rule);

  // GST by rate.
  if (receipt.gstTable && receipt.gstTable.length > 0) {
    lines(gstTableLines(receipt.gstTable, w));
    p.line(rule);
  }

  // Totals.
  const t = receipt.totals;
  if (t.gross !== undefined) lines(leftRight('Gross', showAmount(t.gross), w));
  if (!isZero(t.discount)) lines(leftRight('Discount', showAmount(t.discount), w));
  if (t.taxable !== undefined) lines(leftRight('Taxable value', showAmount(t.taxable), w));
  if (!isZero(t.rounding)) lines(leftRight('Rounding', showAmount(t.rounding), w));
  p.bold(true).doubleHeight(true);
  lines(leftRight(receipt.kind === 'return' ? 'REFUND' : 'TOTAL', rs(t.total), w));
  p.doubleHeight(false).bold(false);

  // Payments and change.
  if (receipt.payments && receipt.payments.length > 0) {
    p.line(rule);
    for (const pay of receipt.payments) {
      const label = receipt.kind === 'return' ? `Refund by ${pay.method}` : pay.method;
      lines(leftRight(label, rs(pay.amount), w));
      if (pay.reference) lines(wrap(`Ref: ${pay.reference}`, w - 2).map((x) => '  ' + x));
    }
  }
  if (receipt.change !== undefined && receipt.change !== null && !isZero(receipt.change)) {
    lines(leftRight('Change', rs(receipt.change), w));
  }

  if (g?.creditNoteLate) lines(wrap('Issued after the GST time limit: the tax of the original bill is not reduced in the return.', w));
  if (g) {
    p.line();
    lines(wrap('Authorised signatory', w));
  }

  // Footer and cut.
  if (receipt.footer) {
    p.line().align('centre');
    for (const part of receipt.footer.split(/\r?\n/)) lines(wrap(part, w));
    p.align('left');
  }
  return p.feed(4).cut().toBuffer();
}
