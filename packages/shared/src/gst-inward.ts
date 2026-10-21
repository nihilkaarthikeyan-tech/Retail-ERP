// Copyright (c) 2026, Rademics. All rights reserved.
// GST on purchases (plan 08 G8, G10 and §3): how the tax on a supplier bill
// line is treated (input credit, cost of the goods, reverse charge), and
// input-credit matching against the inward statement (GSTR-2B) the GST
// portal prepares. Pure functions, shared by the API and the web.
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

// ---- Tax on a purchase line (plan 08 G7, G8) ----

export interface PurchaseTaxLine {
  cgst: DecimalInput;
  sgst: DecimalInput;
  igst: DecimalInput;
  creditClaimable: boolean;
}

export interface PurchaseTaxSplit {
  /** Input credit per head (debited to the input GST accounts). */
  input: { cgst: Decimal; sgst: Decimal; igst: Decimal };
  /** Tax that cannot be claimed: added to the cost of the goods (or the expense). */
  toCost: Decimal;
  /** Under reverse charge: what the shop owes the government per head (credited to the reverse-charge accounts). */
  reverseCharge: { cgst: Decimal; sgst: Decimal; igst: Decimal };
  /** What the supplier is owed for the tax (nothing under reverse charge). */
  owedToSupplier: Decimal;
}

/**
 * Blueprint 13 "Effects on other modules" and the accounting effects map §5:
 * every purchase line debits the input credit accounts, or adds the tax to the
 * goods' cost when credit cannot be claimed; reverse-charge purchases credit
 * a reverse-charge liability (the supplier is paid without tax) and may
 * debit input credit. A composition dealer claims no input credit at all
 * (CGST Act section 10(4),
 * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter3/section10_v1.00.html).
 */
export function purchaseTaxSplit(line: PurchaseTaxLine, opts: { reverseCharge: boolean; composition: boolean }): PurchaseTaxSplit {
  const cgst = D(line.cgst);
  const sgst = D(line.sgst);
  const igst = D(line.igst);
  const tax = cgst.add(sgst).add(igst);
  const claim = line.creditClaimable && !opts.composition;
  return {
    input: claim ? { cgst, sgst, igst } : { cgst: ZERO, sgst: ZERO, igst: ZERO },
    toCost: claim ? ZERO : tax,
    reverseCharge: opts.reverseCharge ? { cgst, sgst, igst } : { cgst: ZERO, sgst: ZERO, igst: ZERO },
    owedToSupplier: opts.reverseCharge ? ZERO : tax,
  };
}

// ---- Return periods ----

/** "2026-09" (a month) or "2026-Q2" (a quarter of the financial year: Q1 = April–June). */
export function periodRange(period: string): { from: string; to: string } | null {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month[1]}-${month[2]}-01`, to: `${month[1]}-${month[2]}-${String(last).padStart(2, '0')}` };
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter) {
    // The year is the financial year's starting year: 2026-Q4 is January–March 2027.
    const fy = Number(quarter[1]);
    const q = Number(quarter[2]);
    const startMonth = [4, 7, 10, 1][q - 1];
    const year = q === 4 ? fy + 1 : fy;
    const endMonth = startMonth + 2;
    const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const mm = (n: number) => String(n).padStart(2, '0');
    return { from: `${year}-${mm(startMonth)}-01`, to: `${year}-${mm(endMonth)}-${mm(last)}` };
  }
  return null;
}

// ---- The inward statement (GSTR-2B) ----

/**
 * GSTR-2B is the auto-drafted statement of input credit the GST portal makes
 * each month from what suppliers reported; it can be downloaded "in Excel
 * and/or JSON formats" from Returns > GSTR-2B (GST portal FAQ,
 * https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm). Its sections
 * follow the form: B2B invoices, B2B credit/debit notes (CDNR), their
 * amendments, ISD and imports; ITC available or not; reverse charge shown per
 * document.
 *
 * The JSON keys read below are those of the portal's download file:
 * data.gstin, data.rtnprd (MMYYYY), data.docdata.b2b[] (ctin, trdnm,
 * inv[]: inum, typ, dt (DD-MM-YYYY), val, pos, rev (Y/N), itcavl (Y/N/T),
 * txval, igst, cgst, sgst, cess) and data.docdata.cdnr[] (ctin, trdnm,
 * nt[]: ntnum, typ (C/D), dt, val, pos, rev, itcavl, txval, igst, cgst, sgst,
 * cess). Amendment sections (b2ba, cdnra) carry the amended documents in the
 * same shape. The CA checks this against a real file before go-live.
 */
export interface InwardDocument {
  section: 'b2b' | 'b2ba' | 'cdnr' | 'cdnra';
  /** invoice, credit_note (the supplier's credit note = our debit note) or debit_note. */
  kind: 'invoice' | 'credit_note' | 'debit_note';
  supplierGstin: string;
  supplierName: string | null;
  number: string;
  /** YYYY-MM-DD. */
  date: string | null;
  value: Decimal;
  taxable: Decimal;
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  cess: Decimal;
  reverseCharge: boolean;
  /** Y, N or T (temporarily unavailable) as on the portal. */
  itcAvailable: string | null;
  placeOfSupply: string | null;
}

export interface InwardStatement {
  gstin: string;
  /** YYYY-MM. */
  period: string;
  documents: InwardDocument[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const amount = (v: unknown): Decimal => {
  if (typeof v === 'number' && Number.isFinite(v)) return roundMoney(new Decimal(String(v)));
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return roundMoney(new Decimal(v.trim()));
  return ZERO;
};

/** "15-09-2026" (portal) or "2026-09-15" → "2026-09-15". */
export function portalDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** "092026" (MMYYYY, the portal's return period) → "2026-09". */
export function portalPeriod(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(0[1-9]|1[0-2])(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1]}`;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  return null;
}

/** Reads the portal's GSTR-2B JSON. Throws with a plain message when it is not one. */
export function parseGstr2b(raw: unknown): InwardStatement {
  const root = obj(raw);
  const data = obj(root.data ?? root);
  const gstin = str(data.gstin)?.toUpperCase();
  const period = portalPeriod(data.rtnprd);
  const docdata = obj(data.docdata);
  if (!gstin || !period || !('docdata' in data)) {
    throw new Error('This is not a GSTR-2B file from the GST portal: it needs the GSTIN, the return period and the documents (download the JSON from Returns > GSTR-2B)');
  }
  const documents: InwardDocument[] = [];
  for (const section of ['b2b', 'b2ba'] as const) {
    for (const s of arr(docdata[section])) {
      const sup = obj(s);
      for (const i of arr(sup.inv)) {
        const d = obj(i);
        const number = str(d.inum);
        if (!number) continue;
        documents.push(inwardDoc(section, 'invoice', sup, d, number));
      }
    }
  }
  for (const section of ['cdnr', 'cdnra'] as const) {
    for (const s of arr(docdata[section])) {
      const sup = obj(s);
      for (const n of arr(sup.nt)) {
        const d = obj(n);
        const number = str(d.ntnum);
        if (!number) continue;
        documents.push(inwardDoc(section, str(d.typ)?.toUpperCase() === 'D' ? 'debit_note' : 'credit_note', sup, d, number));
      }
    }
  }
  return { gstin, period, documents };
}

function inwardDoc(section: InwardDocument['section'], kind: InwardDocument['kind'], sup: Json, d: Json, number: string): InwardDocument {
  return {
    section,
    kind,
    supplierGstin: (str(sup.ctin) ?? '').toUpperCase(),
    supplierName: str(sup.trdnm),
    number,
    date: portalDate(d.dt),
    value: amount(d.val),
    taxable: amount(d.txval),
    igst: amount(d.igst),
    cgst: amount(d.cgst),
    sgst: amount(d.sgst),
    cess: amount(d.cess),
    reverseCharge: str(d.rev)?.toUpperCase() === 'Y',
    itcAvailable: str(d.itcavl)?.toUpperCase() ?? null,
    placeOfSupply: str(d.pos),
  };
}

// ---- Matching (plan 08 §3 "Input credit matching") ----

/**
 * A supplier's document number as typed by different people: case, spaces,
 * punctuation and the leading zeros of each group of digits are ignored, so
 * "SGT/001" and "sgt-1" are the same bill.
 */
export function documentKey(supplierGstin: string, kind: 'invoice' | 'note', number: string): string {
  const n = number
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''))
    .replace(/ /g, '');
  return `${supplierGstin.toUpperCase()}|${kind}|${n}`;
}

export interface BookDocument {
  id: string;
  /** Our number (PB-…). */
  ourNumber: string;
  supplierGstin: string;
  supplierName: string;
  /** invoice for a supplier bill, note for our debit note (the supplier's credit note). */
  kind: 'invoice' | 'note';
  number: string;
  date: string;
  taxable: DecimalInput;
  igst: DecimalInput;
  cgst: DecimalInput;
  sgst: DecimalInput;
  reverseCharge: boolean;
  /** Whether it belongs to the period being matched (only these can be "only in books"). */
  inPeriod: boolean;
}

export type MatchStatus = 'matched' | 'value_difference' | 'only_portal' | 'only_books';

export interface MatchRow {
  status: MatchStatus;
  supplierGstin: string;
  supplierName: string | null;
  number: string;
  kind: 'invoice' | 'note';
  portal: { date: string | null; taxable: string; igst: string; cgst: string; sgst: string; reverseCharge: boolean; itcAvailable: string | null } | null;
  books: { id: string; ourNumber: string; date: string; taxable: string; igst: string; cgst: string; sgst: string; reverseCharge: boolean } | null;
  /** What differs, in plain words. */
  differences: string[];
}

/** Amounts within this are treated as equal (the portal shows rupees and paise; suppliers round differently). */
export const MATCH_TOLERANCE = '1.00';

/**
 * Pairs each document of the portal's statement with our bill from the same
 * supplier GSTIN and number. Same amounts (within the tolerance per head) and
 * the same date → matched; otherwise the differences are listed. Portal
 * documents with no bill are "only on the portal"; our bills of the period
 * with no portal document are "only in our books" (the supplier has not
 * reported them yet, so the credit is not yet available).
 */
export function matchInward(portal: InwardDocument[], books: BookDocument[], tolerance: DecimalInput = MATCH_TOLERANCE): MatchRow[] {
  const tol = D(tolerance);
  const byKey = new Map<string, BookDocument>();
  for (const b of books) byKey.set(documentKey(b.supplierGstin, b.kind, b.number), b);
  const used = new Set<string>();
  const rows: MatchRow[] = [];
  for (const p of portal) {
    const kind = p.kind === 'invoice' ? 'invoice' : 'note';
    const key = documentKey(p.supplierGstin, kind, p.number);
    const b = byKey.get(key);
    const portalSide = { date: p.date, taxable: p.taxable.toFixed(2), igst: p.igst.toFixed(2), cgst: p.cgst.toFixed(2), sgst: p.sgst.toFixed(2), reverseCharge: p.reverseCharge, itcAvailable: p.itcAvailable };
    if (!b || used.has(key)) {
      rows.push({ status: 'only_portal', supplierGstin: p.supplierGstin, supplierName: p.supplierName, number: p.number, kind, portal: portalSide, books: null, differences: [] });
      continue;
    }
    used.add(key);
    const differences: string[] = [];
    const heads: [string, Decimal, DecimalInput][] = [
      ['Taxable value', p.taxable, b.taxable],
      ['IGST', p.igst, b.igst],
      ['CGST', p.cgst, b.cgst],
      ['SGST', p.sgst, b.sgst],
    ];
    for (const [label, pv, bv] of heads) {
      // Our debit notes carry minus amounts; the portal shows the note's amounts as plus.
      const ours = D(bv).abs();
      if (pv.abs().sub(ours).abs().gt(tol)) differences.push(`${label}: portal ₹${pv.abs().toFixed(2)}, books ₹${ours.toFixed(2)}`);
    }
    if (p.date && p.date !== b.date) differences.push(`Date: portal ${p.date}, books ${b.date}`);
    if (p.reverseCharge !== b.reverseCharge) differences.push(`Reverse charge: portal ${p.reverseCharge ? 'yes' : 'no'}, books ${b.reverseCharge ? 'yes' : 'no'}`);
    rows.push({
      status: differences.length ? 'value_difference' : 'matched',
      supplierGstin: p.supplierGstin,
      supplierName: p.supplierName ?? b.supplierName,
      number: p.number,
      kind,
      portal: portalSide,
      books: { id: b.id, ourNumber: b.ourNumber, date: b.date, taxable: D(b.taxable).toFixed(2), igst: D(b.igst).toFixed(2), cgst: D(b.cgst).toFixed(2), sgst: D(b.sgst).toFixed(2), reverseCharge: b.reverseCharge },
      differences,
    });
  }
  for (const b of books) {
    const key = documentKey(b.supplierGstin, b.kind, b.number);
    if (used.has(key) || !b.inPeriod) continue;
    rows.push({
      status: 'only_books',
      supplierGstin: b.supplierGstin,
      supplierName: b.supplierName,
      number: b.number,
      kind: b.kind,
      portal: null,
      books: { id: b.id, ourNumber: b.ourNumber, date: b.date, taxable: D(b.taxable).toFixed(2), igst: D(b.igst).toFixed(2), cgst: D(b.cgst).toFixed(2), sgst: D(b.sgst).toFixed(2), reverseCharge: b.reverseCharge },
      differences: [],
    });
  }
  return rows;
}

/** Counts per status, for the summary at the top of the matching screen. */
export function matchSummary(rows: MatchRow[]): Record<MatchStatus, number> {
  const out: Record<MatchStatus, number> = { matched: 0, value_difference: 0, only_portal: 0, only_books: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: 'Matched',
  value_difference: 'Amounts differ',
  only_portal: 'Only on the portal',
  only_books: 'Only in our books',
};
