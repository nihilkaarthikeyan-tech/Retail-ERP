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
  /** Audit 4 (28 October 2026): the unit code printed after the quantity (CGST Rules rule 46(i)). */
  unit?: string | null;
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
  /** Audit 4 (28 October 2026): the buyer's tax situation (regular, unregistered, sez, reverse_charge). */
  buyerSituation?: string | null;
  /** Audit 4: the rule 46 third-proviso SEZ endorsement, when the ERP worked it out. */
  endorsement?: string | null;
  /** Audit 4: tax_invoice, bill_of_supply, invoice_cum_bill_of_supply, credit_note or return_note. */
  documentKind?: string | null;
}

/** Plan 13: the points block (earned, spent, given and taken back, balance). */
export interface ReceiptLoyalty {
  scheme: string;
  earned: number;
  spent: number;
  restored: number;
  reversed: number;
  /** The customer's balance after this bill; null when not known (offline). */
  balance: number | null;
  note?: string | null;
}

export const GIFT_CARD_ACTIONS = ['sold', 'loaded', 'spent', 'refunded'] as const;

/** Plan 13: a gift card on the receipt. Sold or loaded: the full number (with a barcode); spent or refunded: the last 4 digits. */
export interface ReceiptGiftCard {
  action: (typeof GIFT_CARD_ACTIONS)[number];
  number: string;
  barcode: boolean;
  amount: Amount;
  balance: Amount;
  /** The first day the card no longer works (YYYY-MM-DD). */
  expiresOn: string;
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
  /** Audit 4 (28 October 2026): false = the business switched the GST table off; the tax still prints, one short line per rate. */
  taxTable?: boolean;
  /** Audit 4: the document kind and title the ERP worked out. */
  documentKind?: string | null;
  documentTitle?: string | null;
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
  /** Plan 13: a title in place of the usual one (e.g. "GIFT CARD RECEIPT"). */
  title?: string | null;
  loyalty?: ReceiptLoyalty | null;
  giftCards?: ReceiptGiftCard[] | null;
}

export type PaperWidth = 80 | 58;

/** Characters per line in the printer's normal font. */
export function columnsFor(paper: PaperWidth): number {
  return paper === 58 ? 32 : 48;
}

/** CGST Rules rule 46, third proviso: the endorsement on a supply to an SEZ unit or developer. */
export const SEZ_WITH_IGST = 'SUPPLY MEANT FOR SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX';
export const SEZ_UNDER_LUT = 'SUPPLY MEANT FOR SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX';
/** Audit 4 (28 October 2026): a return note is not a credit note and carries no GST. */
export const RETURN_NOTE_LINE = 'Not a credit note: no GST is reduced';

/** Only an older bill saved as provisional (before 22 Oct 2026) carries this note; new bills never do. */
export const PROVISIONAL_NOTE = 'GST provisional (an older bill)';

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
    if (!isOptText(l.code) || !isOptText(l.hsn) || !isOptText(l.unit)) return fail(`receipt.lines[${i}].code/hsn/unit must be text`);
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

  if (r.taxTable !== undefined && typeof r.taxTable !== 'boolean') return fail('receipt.taxTable must be true or false');
  if (!isOptText(r.documentKind) || !isOptText(r.documentTitle)) return fail('receipt.documentKind and documentTitle must be text');
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
    if (!isOptText(g.invoiceKind) || !isOptText(g.sellerGstin) || !isOptText(g.declaration) || !isOptText(g.buyerSituation) || !isOptText(g.endorsement) || !isOptText(g.documentKind)) {
      return fail('receipt.gst text fields must be text');
    }
    if (!isState(g.placeOfSupply)) return fail('receipt.gst.placeOfSupply must have code and name');
    if (g.buyer !== undefined && g.buyer !== null && (!isObj(g.buyer) || !isOptText(g.buyer.name) || !isOptText(g.buyer.gstin) || !isOptText(g.buyer.address) || !isState(g.buyer.state))) {
      return fail('receipt.gst.buyer must have name, gstin, address and state as text');
    }
    if (g.original !== undefined && g.original !== null && (!isObj(g.original) || !isText(g.original.number) || !isOptText(g.original.date))) return fail('receipt.gst.original must have the bill number');
    for (const k of ['reverseCharge', 'creditNoteLate'] as const) {
      if (g[k] !== undefined && typeof g[k] !== 'boolean') return fail(`receipt.gst.${k} must be true or false`);
    }
  }
  if (!isOptText(r.title)) return fail('receipt.title must be text');
  if (r.loyalty !== undefined && r.loyalty !== null) {
    const l = r.loyalty;
    if (!isObj(l) || !isText(l.scheme)) return fail('receipt.loyalty.scheme is required');
    for (const k of ['earned', 'spent', 'restored', 'reversed'] as const) {
      if (!isPoints(l[k])) return fail(`receipt.loyalty.${k} must be a whole number of points`);
    }
    if (l.balance !== null && l.balance !== undefined && !(typeof l.balance === 'number' && Number.isInteger(l.balance))) return fail('receipt.loyalty.balance must be a whole number or empty');
    if (!isOptText(l.note)) return fail('receipt.loyalty.note must be text');
  }
  if (r.giftCards !== undefined && r.giftCards !== null) {
    if (!Array.isArray(r.giftCards) || r.giftCards.length > 10) return fail('receipt.giftCards must be a list of at most 10');
    for (const [i, g] of r.giftCards.entries()) {
      if (!isObj(g)) return fail(`receipt.giftCards[${i}] must be an object`);
      if (!(GIFT_CARD_ACTIONS as readonly unknown[]).includes(g.action)) return fail(`receipt.giftCards[${i}].action must be sold, loaded, spent or refunded`);
      if (!isText(g.number) || !g.number || g.number.length > 40) return fail(`receipt.giftCards[${i}].number is required`);
      if (typeof g.barcode !== 'boolean') return fail(`receipt.giftCards[${i}].barcode must be true or false`);
      if (g.barcode && !/^\d{1,40}$/.test(g.number.replace(/\s/g, ''))) return fail(`receipt.giftCards[${i}].number must be digits for a barcode`);
      if (!isAmount(g.amount) || !isAmount(g.balance)) return fail(`receipt.giftCards[${i}] amount and balance must be numbers`);
      if (!isText(g.expiresOn) || !/^\d{4}-\d{2}-\d{2}$/.test(g.expiresOn)) return fail(`receipt.giftCards[${i}].expiresOn must be a date (YYYY-MM-DD)`);
    }
  }
  return { ok: true, receipt: input as unknown as Receipt };
}

function isPoints(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** The day before `expiresOn` (the last day a card works), as DD-MM-YYYY. A date, not money. */
export function lastValidDay(expiresOn: string): string {
  const d = new Date(`${expiresOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

const GIFT_CARD_LABEL = { sold: 'Gift card sold', loaded: 'Gift card loaded', spent: 'Paid by gift card', refunded: 'Back on gift card' } as const;

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

/**
 * Audit 4 (28 October 2026): what the receipt prints about tax. A tax invoice or
 * credit note always shows its tax per rate (rule 46(k)-(m)), as the table or,
 * with the table switched off, one short line per rate; a bill of supply and a
 * return note show none. Every tax invoice states reverse charge (rule 46(p));
 * a supply to an SEZ carries the rule 46 third-proviso endorsement.
 */
export function taxView(receipt: Receipt) {
  const g = receipt.gst ?? null;
  const isNote = (t: string | null | undefined) => (t ?? '').trim().toLowerCase() === 'return note';
  const returnNote = isNote(g?.title) || isNote(receipt.documentTitle) || (g?.documentKind ?? receipt.documentKind) === 'return_note';
  const taxed = g ? !returnNote && g.invoiceKind !== 'bill_of_supply' : true;
  const rows = taxed ? (receipt.gstTable ?? []) : [];
  const igst = rows.some((x) => !isZero(x.igst));
  const taxInvoice = !!g && taxed && receipt.kind === 'sale';
  const situation = g?.buyerSituation ?? null;
  return {
    returnNote,
    rows,
    table: rows.length > 0 && receipt.taxTable !== false,
    short: rows.length > 0 && receipt.taxTable === false,
    reverseCharge: taxInvoice ? (g!.reverseCharge || situation === 'reverse_charge' ? 'Yes' : 'No') : null,
    endorsement: taxInvoice ? (g?.endorsement ?? (situation === 'sez' && rows.length ? (igst ? SEZ_WITH_IGST : SEZ_UNDER_LUT) : null)) : null,
  };
}

/** One short line per rate: "GST 5%: taxable Rs. 1000.00, CGST Rs. 25.00, SGST Rs. 25.00" (or IGST). */
function gstShortLines(rows: GstRow[], width: number): string[] {
  const out: string[] = [];
  for (const g of rows) {
    const tax = !isZero(g.igst) ? `IGST ${rs(g.igst)}` : `CGST ${rs(g.cgst ?? '0.00')}, SGST ${rs(g.sgst ?? '0.00')}`;
    out.push(...wrap(`GST ${showRate(g.rate)}: taxable ${rs(g.taxable)}, ${tax}`, width));
  }
  return out;
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
  const view = taxView(receipt);
  const sellerGstin = g?.sellerGstin ?? receipt.company.gstin;
  if (sellerGstin) lines(wrap(`GSTIN: ${sellerGstin}`, w));
  if (receipt.store.address) lines(wrap(receipt.store.address, w));
  if (receipt.store.phone) lines(wrap(`Phone: ${receipt.store.phone}`, w));

  // Title.
  p.line().bold(true);
  const title = receipt.title?.trim() || receipt.documentTitle?.trim() || (g ? g.title : receipt.kind === 'return' ? 'CREDIT NOTE / RETURN' : 'TAX INVOICE');
  lines(wrap(title.toUpperCase(), w));
  if (receipt.duplicate) lines(wrap('DUPLICATE', w));
  p.bold(false);
  if (g?.declaration) lines(wrap(g.declaration, w));
  if (view.endorsement) lines(wrap(view.endorsement, w));
  if (view.returnNote) lines(wrap(RETURN_NOTE_LINE, w));
  if (receipt.provisional) lines(wrap(PROVISIONAL_NOTE, w));

  // Bill number, date and till.
  p.align('left');
  const numberLabel = view.returnNote ? 'Return note' : receipt.kind === 'return' ? 'Credit note' : 'Bill';
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
  // Rule 46(p): on every tax invoice, not only business ones.
  if (view.reverseCharge) lines(wrap(`Tax payable on reverse charge: ${view.reverseCharge}`, w));

  // Items.
  p.line(rule);
  lines(leftRight('Item', 'Amount', w));
  p.line(rule);
  for (const l of receipt.lines) {
    lines(wrap(l.name, w));
    const unit = l.unit?.trim();
    lines(leftRight(`  ${showQty(l.quantity)}${unit ? ` ${unit}` : ''} x ${showAmount(l.price)}`, l.free ? 'FREE' : showAmount(l.amount), w));
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
  if (view.table) {
    lines(gstTableLines(view.rows, w));
    p.line(rule);
  } else if (view.short) {
    lines(gstShortLines(view.rows, w));
    p.line(rule);
  }

  // Totals.
  const t = receipt.totals;
  if (t.gross !== undefined) lines(leftRight('Gross', showAmount(t.gross), w));
  if (!isZero(t.discount)) lines(leftRight('Discount', showAmount(t.discount), w));
  if (t.taxable !== undefined && !view.returnNote) lines(leftRight('Taxable value', showAmount(t.taxable), w));
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

  // Plan 13: gift cards (a sold or loaded card with its barcode) and points.
  for (const c of receipt.giftCards ?? []) {
    p.line(rule);
    lines(leftRight(GIFT_CARD_LABEL[c.action], rs(c.amount), w));
    lines(wrap(`Card: ${c.number}`, w));
    lines(leftRight('Balance on card', rs(c.balance), w));
    lines(wrap(`Valid until ${lastValidDay(c.expiresOn)}`, w));
    if (c.barcode) {
      p.align('centre').barcode128(c.number.replace(/\s/g, ''));
      p.align('left');
    }
  }
  const pts = receipt.loyalty;
  if (pts) {
    p.line(rule);
    lines(wrap(pts.scheme, w));
    const rowsOf: [string, number][] = [
      ['Points earned', pts.earned],
      ['Points spent', pts.spent],
      ['Points given back', pts.restored],
      ['Points taken back', pts.reversed],
    ];
    for (const [label, n] of rowsOf) if (n !== 0) lines(leftRight(label, String(n), w));
    if (pts.balance !== null && pts.balance !== undefined) lines(leftRight('Points balance', String(pts.balance), w));
    if (pts.note) lines(wrap(pts.note, w));
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
