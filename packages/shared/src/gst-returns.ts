// Copyright (c) 2026, Rademics. All rights reserved.
// GST return figures (plan 08 §3, blueprint 13 process 8): return periods,
// how each outward document is sorted into the sections of the outward
// return (GSTR-1), the HSN summary and documents-issued groupings, the legal
// order of setting input credit off against tax (GSTR-3B), and the GST
// portal's offline-tool JSON. Pure functions, shared by the API and the web.
// Money is Decimal throughout; plain numbers appear only in the JSON file,
// where the portal's format asks for them.
//
// Official sources (checked 18 October 2026; the CA confirms before go-live):
// - GSTR-1 tables and the B2C (large) limit: "Returns Offline Tool FAQs and
//   User Manual", https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf
//   (worksheets b2b, b2cl, b2cs, cdnr, cdnur, exemp, hsn(b2b), hsn(b2c), docs;
//   B2CL = inter-state invoices to consumers above ₹1 lakh from the August
//   2024 return period, above ₹2.5 lakh up to July 2024).
// - GSTR-1 JSON: the GST Developer Portal, Returns API "GSTR1 - Save GSTR1
//   data", version v4.1 (published 4 Feb 2025): request schema and sample
//   payload at https://developer.gst.gov.in/pages/apiportal/data/Returns/
//   (path "GSTR1 - Save GSTR1 data/v4.1/"). That payload is what the offline
//   tool uploads; the field names below are copied from it.
// - Table 13 "Nature of document" numbering and the GSTR-3B tables: CGST
//   Rules, Part B (Forms), FORM GSTR-1 table 13 and FORM GSTR-3B,
//   https://cbic-gst.gov.in/pdf/01062021-CGST-Rules-2017-Part-B-Forms.pdf
// - Unit quantity codes (UQC): e-invoice portal master codes,
//   https://einvoice1.gst.gov.in/Others/MasterCodes
// - Order of using input credit: CGST Act section 49(5) and section 49A,
//   https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter10/section49_v1.00.html
//   and CGST Rules rule 88A,
//   https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter9/rule88a_v1.00.html
// - Reverse-charge tax is paid in cash: section 49(4) lets the credit ledger
//   pay "output tax" only, and output tax (section 2(82)) excludes tax payable
//   under reverse charge.
import { ji, jm, type JsonNumber } from './gst-portal.js';
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

const D = (v: DecimalInput | null | undefined) => new Decimal(v ?? 0);
const ZERO = new Decimal(0);

// ---- Return periods ----

export type ReturnPeriodKind = 'month' | 'quarter';

export interface ReturnPeriod {
  /** "2026-09" (a month) or "2026-Q2" (a quarter of the financial year starting in 2026: Q1 = April–June). */
  period: string;
  kind: ReturnPeriodKind;
  from: string;
  to: string;
  /** The portal's return period, MMYYYY of the last month (quarterly filers file with the quarter's third month). */
  fp: string;
  label: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A month ("2026-09") or a quarter of a financial year ("2026-Q2" = July–September 2026). Null when it is neither. */
export function gstReturnPeriod(period: string): ReturnPeriod | null {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    return { period, kind: 'month', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, fp: `${pad(m)}${y}`, label: `${MONTHS[m - 1]} ${y}` };
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter) {
    const fy = Number(quarter[1]);
    const q = Number(quarter[2]);
    const start = [4, 7, 10, 1][q - 1];
    const year = q === 4 ? fy + 1 : fy;
    const end = start + 2;
    return {
      period,
      kind: 'quarter',
      from: `${year}-${pad(start)}-01`,
      to: `${year}-${pad(end)}-${pad(lastDay(year, end))}`,
      fp: `${pad(end)}${year}`,
      label: `${MONTHS[start - 1]}–${MONTHS[end - 1]} ${year} (quarter ${q} of ${fy}-${String(fy + 1).slice(2)})`,
    };
  }
  return null;
}

/** The return period a date falls in, by the filing frequency setting. */
export function returnPeriodOf(date: string, frequency: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (frequency !== 'quarterly') return date.slice(0, 7);
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `${fy}-Q${q}`;
}

/** The period just before this one (same kind). */
export function previousReturnPeriod(period: string): string {
  const p = gstReturnPeriod(period);
  if (!p) throw new Error(`Not a return period: ${period}`);
  const y = Number(p.from.slice(0, 4));
  const m = Number(p.from.slice(5, 7));
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  return p.kind === 'month' ? prevMonth : returnPeriodOf(`${prevMonth}-01`, 'quarterly');
}

/** Every return period from one to another, oldest first (both included). */
export function returnPeriodsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let p = last;
  for (let guard = 0; guard < 600; guard++) {
    out.unshift(p);
    if (p === first || (gstReturnPeriod(p)?.from ?? '') <= (gstReturnPeriod(first)?.from ?? '')) break;
    p = previousReturnPeriod(p);
  }
  return out;
}

/** "2026-09-15" → "15-09-2026", the date form of the GSTR-1 JSON (dd-mm-yyyy). */
export function returnDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}-${isoDate.slice(0, 4)}`;
}

// ---- Sorting documents into the outward return (GSTR-1) ----

/**
 * B2C (large): an inter-state invoice to an unregistered buyer whose invoice
 * value is above this limit. ₹1 lakh from the August 2024 return period,
 * ₹2.5 lakh before (offline tool manual, cited above).
 */
export function largeConsumerLimit(invoiceDate: string): Decimal {
  return new Decimal(invoiceDate >= '2024-08-01' ? '100000' : '250000');
}

export type OutwardSection = 'b2b' | 'b2cl' | 'b2cs' | 'excluded';
export type NoteSection = 'cdnr' | 'cdnur' | 'b2cs' | 'excluded';

export interface OutwardDoc {
  /** consumer, business or bill_of_supply (plan 08 G4, G5, G7). */
  invoiceKind: string;
  buyerGstin?: string | null;
  /** State code of the place of supply. */
  placeOfSupply: string;
  /** State code of the seller's registration. */
  sellerState: string;
  /** Invoice value including tax (a plus figure). */
  value: DecimalInput;
  /** YYYY-MM-DD. */
  date: string;
}

/**
 * Which table of GSTR-1 an invoice belongs in: registered buyers (B2B, table
 * 4); large inter-state consumer invoices (B2CL, table 5); every other
 * consumer sale, totalled by state and rate (B2CS, table 7). A composition
 * dealer's bills of supply are not reported in GSTR-1.
 */
export function outwardSection(d: OutwardDoc): OutwardSection {
  if (d.invoiceKind === 'bill_of_supply') return 'excluded';
  if (d.invoiceKind === 'business' && d.buyerGstin) return 'b2b';
  const interState = d.placeOfSupply !== d.sellerState;
  if (interState && D(d.value).abs().gt(largeConsumerLimit(d.date))) return 'b2cl';
  return 'b2cs';
}

/**
 * Where a credit note goes: against a B2B invoice, credit/debit notes
 * (registered, CDNR, table 9B); against a B2CL invoice, credit/debit notes
 * (unregistered, CDNUR, type "B2CL"); against any other consumer sale it is
 * netted into the B2CS figures ("supplies net of debit notes and credit notes
 * are reported", GSTR-1 FAQ, https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm).
 * A note with no original invoice is treated as a consumer note.
 */
export function noteSection(original: OutwardDoc | null): NoteSection {
  if (!original) return 'b2cs';
  const s = outwardSection(original);
  if (s === 'b2b') return 'cdnr';
  if (s === 'b2cl') return 'cdnur';
  return s;
}

/** Nil-rated and exempt supplies (table 8): inter- or intra-state, to registered or unregistered buyers. */
export type NilSupplyType = 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C';
export function nilSupplyType(registered: boolean, interState: boolean): NilSupplyType {
  return `${interState ? 'INTR' : 'INTRA'}${registered ? 'B2B' : 'B2C'}` as NilSupplyType;
}

// ---- Grouping with exact totals ----

export interface TaxFigures {
  taxable: Decimal;
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  cess: Decimal;
}

export function emptyFigures(): TaxFigures {
  return { taxable: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO };
}

export function addFigures(a: TaxFigures, b: Partial<Record<keyof TaxFigures, DecimalInput | null | undefined>>, sign: 1 | -1 = 1): TaxFigures {
  const s = (k: keyof TaxFigures) => a[k].add(D(b[k]).mul(sign));
  return { taxable: s('taxable'), igst: s('igst'), cgst: s('cgst'), sgst: s('sgst'), cess: s('cess') };
}

export function figuresTax(f: TaxFigures): Decimal {
  return f.igst.add(f.cgst).add(f.sgst).add(f.cess);
}

/** Groups rows by a key and adds their tax figures; keys keep the order they were first seen. */
export function sumFiguresBy<T>(rows: T[], key: (r: T) => string, figures: (r: T) => Partial<Record<keyof TaxFigures, DecimalInput | null | undefined>>, sign: (r: T) => 1 | -1 = () => 1): Map<string, { first: T; figures: TaxFigures; count: number }> {
  const out = new Map<string, { first: T; figures: TaxFigures; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = out.get(k) ?? { first: r, figures: emptyFigures(), count: 0 };
    g.figures = addFigures(g.figures, figures(r), sign(r));
    g.count += 1;
    out.set(k, g);
  }
  return out;
}

export function figuresEqual(a: TaxFigures, b: TaxFigures): boolean {
  return (['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const).every((k) => roundMoney(a[k]).eq(roundMoney(b[k])));
}

// ---- HSN summary (table 12) ----

/** The HSN code reported: the configured digits (4, 6 or 8; decision 59), never more than is stored. */
export function hsnForReturn(hsnCode: string | null | undefined, digits: number): string {
  if (!hsnCode) return '';
  return hsnCode.replace(/\s/g, '').slice(0, Math.max(4, digits));
}

// ---- Documents issued (table 13) ----

/** Table 13 "Nature of document" numbers used by a shop (FORM GSTR-1). */
export const DOCUMENT_NATURES = { 1: 'Invoices for outward supply', 4: 'Debit Note', 5: 'Credit Note', 12: 'Delivery Challan in cases other than by way of supply' } as const;

/** "MAIN-T1-2026-27-000042" → series "MAIN-T1-2026-27-", number 42. The series is everything before the last run of digits. */
export function splitDocumentNumber(number: string): { series: string; seq: number | null } {
  const m = /^(.*?)(\d+)$/.exec(number);
  if (!m) return { series: number, seq: null };
  return { series: m[1], seq: Number(m[2]) };
}

export interface DocumentSeriesRow {
  series: string;
  from: string;
  to: string;
  /** Documents issued in the period, cancelled ones included. */
  total: number;
  cancelled: number;
  net: number;
  /** Numbers between the first and the last that were never issued (an unexplained gap). */
  missing: number;
}

/** Per series: first and last number, how many issued and cancelled, and gaps (plan 08 G11). */
export function documentSeries(docs: { number: string; cancelled: boolean }[]): DocumentSeriesRow[] {
  const bySeries = new Map<string, { number: string; seq: number | null; cancelled: boolean }[]>();
  for (const d of docs) {
    const s = splitDocumentNumber(d.number);
    bySeries.set(s.series, [...(bySeries.get(s.series) ?? []), { number: d.number, seq: s.seq, cancelled: d.cancelled }]);
  }
  const out: DocumentSeriesRow[] = [];
  for (const [series, list] of bySeries) {
    list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.number.localeCompare(b.number));
    const seqs = [...new Set(list.map((d) => d.seq).filter((s): s is number => s !== null))];
    const span = seqs.length ? seqs[seqs.length - 1] - seqs[0] + 1 : list.length;
    const cancelled = list.filter((d) => d.cancelled).length;
    out.push({ series, from: list[0].number, to: list[list.length - 1].number, total: list.length, cancelled, net: list.length - cancelled, missing: Math.max(0, span - seqs.length) });
  }
  return out.sort((a, b) => a.series.localeCompare(b.series));
}

/** Rule 46(b): an invoice number of up to 16 characters, letters, digits, "-" and "/" (also the portal's inum pattern). */
export function invoiceNumberProblem(number: string): string | null {
  if (number.length > 16) return 'longer than 16 characters';
  if (!/^[A-Za-z0-9/-]+$/.test(number)) return 'has characters other than letters, digits, "-" and "/"';
  return null;
}

// ---- GSTR-3B: setting input credit off against tax ----

export type Head = 'igst' | 'cgst' | 'sgst';
export type Heads = Record<Head, Decimal>;
export type HeadsInput = Record<Head, DecimalInput | null | undefined>;

export const HEADS: Head[] = ['igst', 'cgst', 'sgst'];

const heads = (v?: Partial<HeadsInput>): Heads => ({ igst: D(v?.igst), cgst: D(v?.cgst), sgst: D(v?.sgst) });

export interface SetOffStep {
  /** Credit of this head … */
  credit: Head;
  /** … paid this tax. */
  against: Head;
  amount: Decimal;
}

export interface SetOffResult {
  liability: Heads;
  credit: Heads;
  steps: SetOffStep[];
  /** Tax per head paid from credit. */
  paidByCredit: Heads;
  /** Tax per head still to be paid in cash. */
  cash: Heads;
  /** Credit per head left over, carried to the next period (never below zero). */
  creditLeft: Heads;
}

/**
 * Sets input credit off against tax in the legal order:
 * 1. IGST credit first against IGST (section 49(5)(a), rule 88A);
 * 2. the IGST credit left goes to CGST and SGST "in any order" (rule 88A),
 *    and must be used up before any CGST or SGST credit is used (section 49A).
 *    We send it first where CGST or SGST credit cannot cover the tax, CGST
 *    before SGST, so the least cash is paid; any IGST credit still left then
 *    pays CGST and then SGST;
 * 3. CGST credit against CGST, then against IGST (section 49(5)(b));
 * 4. SGST credit against SGST, then against IGST, only after CGST credit is
 *    used for IGST (section 49(5)(c) and its proviso).
 * CGST credit never pays SGST and SGST credit never pays CGST (section
 * 49(5)(e), (f)). A minus figure (more credit notes than sales) counts as
 * nothing to pay; a minus credit counts as no credit.
 */
export function setOffCredit(liabilityIn: Partial<HeadsInput>, creditIn: Partial<HeadsInput>): SetOffResult {
  const liability = heads(liabilityIn);
  const credit = heads(creditIn);
  const L = { igst: Decimal.max(liability.igst, 0), cgst: Decimal.max(liability.cgst, 0), sgst: Decimal.max(liability.sgst, 0) };
  const C = { igst: Decimal.max(credit.igst, 0), cgst: Decimal.max(credit.cgst, 0), sgst: Decimal.max(credit.sgst, 0) };
  const steps: SetOffStep[] = [];
  const use = (from: Head, to: Head, cap?: Decimal) => {
    let amount = Decimal.min(C[from], L[to]);
    if (cap) amount = Decimal.min(amount, Decimal.max(cap, 0));
    if (amount.lte(0)) return;
    C[from] = C[from].sub(amount);
    L[to] = L[to].sub(amount);
    const same = steps.find((s) => s.credit === from && s.against === to);
    if (same) same.amount = same.amount.add(amount);
    else steps.push({ credit: from, against: to, amount });
  };
  use('igst', 'igst');
  use('igst', 'cgst', L.cgst.sub(C.cgst));
  use('igst', 'sgst', L.sgst.sub(C.sgst));
  use('igst', 'cgst');
  use('igst', 'sgst');
  use('cgst', 'cgst');
  use('cgst', 'igst');
  use('sgst', 'sgst');
  use('sgst', 'igst');
  const paidByCredit = { igst: ZERO, cgst: ZERO, sgst: ZERO };
  for (const s of steps) paidByCredit[s.against] = paidByCredit[s.against].add(s.amount);
  return { liability, credit, steps, paidByCredit, cash: { ...L }, creditLeft: { ...C } };
}

export interface PeriodTax {
  period: string;
  /** Output tax per head (forward charge). */
  output: Partial<HeadsInput>;
  /** Input credit of the period per head (net of debit notes). */
  credit: Partial<HeadsInput>;
  /** Tax the shop owes under reverse charge, paid in cash only. */
  reverseCharge: Partial<HeadsInput>;
}

export interface PeriodPosition extends SetOffResult {
  period: string;
  /** Credit brought from the period before. */
  broughtForward: Heads;
  reverseCharge: Heads;
  /** Cash to pay per head: tax left after credit plus reverse-charge tax. */
  netPayable: Heads;
  totalPayable: Decimal;
}

/**
 * Period after period: each period's credit is its own input credit plus what
 * the period before carried forward; the reverse-charge tax is added to the
 * cash to pay (blueprint 13, "Net GST payable").
 */
export function gstPositions(periods: PeriodTax[], openingCredit?: Partial<HeadsInput>): PeriodPosition[] {
  let carry = heads(openingCredit);
  const out: PeriodPosition[] = [];
  for (const p of periods) {
    const own = heads(p.credit);
    const available = { igst: carry.igst.add(own.igst), cgst: carry.cgst.add(own.cgst), sgst: carry.sgst.add(own.sgst) };
    const r = setOffCredit(p.output, available);
    const rc = heads(p.reverseCharge);
    const rcPay = { igst: Decimal.max(rc.igst, 0), cgst: Decimal.max(rc.cgst, 0), sgst: Decimal.max(rc.sgst, 0) };
    const netPayable = { igst: r.cash.igst.add(rcPay.igst), cgst: r.cash.cgst.add(rcPay.cgst), sgst: r.cash.sgst.add(rcPay.sgst) };
    out.push({ ...r, period: p.period, broughtForward: carry, reverseCharge: rc, netPayable, totalPayable: netPayable.igst.add(netPayable.cgst).add(netPayable.sgst) });
    carry = r.creditLeft;
  }
  return out;
}

// ---- The GST portal's offline-tool JSON (GSTR-1) ----

/** Our GSTR-1 figures as the API returns them (decimal strings). */
export interface Gstr1Item {
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

export interface Gstr1Invoice {
  number: string;
  date: string;
  value: string;
  placeOfSupply: string;
  buyerGstin: string | null;
  reverseCharge: boolean;
  items: Gstr1Item[];
  /** Audit 4: R regular; SEWP / SEWOP a supply to an SEZ with / without payment of tax (GSTR-1 table 6B). */
  invType?: 'R' | 'SEWP' | 'SEWOP';
  /** Audit 4: IGST heads; an SEZ supply is inter-state even in the seller's own state (IGST Act s.7(5)(b)). */
  interState?: boolean;
}

export interface Gstr1Note extends Gstr1Invoice {
  noteType: 'C' | 'D';
}

export interface Gstr1B2csRow extends Gstr1Item {
  supplyType: 'INTER' | 'INTRA';
  placeOfSupply: string;
}

export interface Gstr1NilRow {
  supplyType: NilSupplyType;
  nil: string;
  exempt: string;
  nonGst: string;
}

export interface Gstr1HsnRow extends Gstr1Item {
  hsn: string;
  description: string;
  uqc: string;
  quantity: string;
}

export interface Gstr1DocRow extends DocumentSeriesRow {
  nature: keyof typeof DOCUMENT_NATURES;
}

export interface Gstr1Figures {
  gstin: string;
  fp: string;
  b2b: Gstr1Invoice[];
  b2cl: Gstr1Invoice[];
  b2cs: Gstr1B2csRow[];
  cdnr: Gstr1Note[];
  cdnur: Gstr1Note[];
  nil: Gstr1NilRow[];
  hsnBusiness: Gstr1HsnRow[];
  hsnConsumer: Gstr1HsnRow[];
  documents: Gstr1DocRow[];
}

/** A decimal as an exact JSON number with at most two places (the portal's "multipleOf 0.01"); never through a float. */
const n2 = (v: DecimalInput): JsonNumber => jm(D(v));
const abs2 = (v: DecimalInput): JsonNumber => jm(D(v).abs());

function itemDetails(items: Gstr1Item[], interState: boolean, absolute: boolean) {
  const f = absolute ? abs2 : n2;
  return items.map((it, i) => ({
    num: ji(i + 1),
    itm_det: interState ? { rt: n2(it.rate), txval: f(it.taxable), iamt: f(it.igst), csamt: f(it.cess) } : { rt: n2(it.rate), txval: f(it.taxable), camt: f(it.cgst), samt: f(it.sgst), csamt: f(it.cess) },
  }));
}

/**
 * The GSTR-1 file in the portal's JSON format ("GSTR1 - Save GSTR1 data",
 * v4.1, cited above): gstin, fp (MMYYYY), b2b[ctin, inv[inum, idt, val, pos,
 * rchrg, inv_typ, itms[num, itm_det{rt, txval, iamt | camt + samt, csamt}]]],
 * b2cl[pos, inv[inum, idt, val, itms]], b2cs[sply_ty, pos, typ, rt, txval,
 * iamt | camt + samt, csamt], cdnr[ctin, nt[ntty, nt_num, nt_dt, val, pos,
 * rchrg, inv_typ, itms]], cdnur[typ "B2CL", ntty, nt_num, nt_dt, val, pos,
 * itms], nil{inv[sply_ty, nil_amt, expt_amt, ngsup_amt]},
 * hsn{hsn_b2b[], hsn_b2c[]: num, hsn_sc, desc, uqc, qty, rt, txval, iamt,
 * camt, samt, csamt}, doc_issue{doc_det[doc_num, doc_typ, docs[num, from, to,
 * totnum, cancel, net_issue]]}. Empty sections are left out. Credit notes
 * carry plus amounts with ntty "C"; B2CS and HSN rows are net and may be minus.
 * Numbers are JsonNumber: write the file with stringifyPortalJson (gst-portal).
 */
export function gstr1PortalJson(f: Gstr1Figures, sellerState: string): Record<string, unknown> {
  const out: Record<string, unknown> = { gstin: f.gstin, fp: f.fp };
  const byBuyer = <T extends Gstr1Invoice>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.buyerGstin ?? '', [...(m.get(x.buyerGstin ?? '') ?? []), x]);
    return m;
  };
  if (f.b2b.length) {
    out.b2b = [...byBuyer(f.b2b)].map(([ctin, invs]) => ({
      ctin,
      inv: invs.map((x) => ({ inum: x.number, idt: returnDate(x.date), val: abs2(x.value), pos: x.placeOfSupply, rchrg: x.reverseCharge ? 'Y' : 'N', inv_typ: x.invType ?? 'R', itms: itemDetails(x.items, x.interState ?? x.placeOfSupply !== sellerState, true) })),
    }));
  }
  if (f.b2cl.length) {
    const byPos = new Map<string, Gstr1Invoice[]>();
    for (const x of f.b2cl) byPos.set(x.placeOfSupply, [...(byPos.get(x.placeOfSupply) ?? []), x]);
    out.b2cl = [...byPos].map(([pos, invs]) => ({ pos, inv: invs.map((x) => ({ inum: x.number, idt: returnDate(x.date), val: abs2(x.value), itms: itemDetails(x.items, true, true) })) }));
  }
  // Audit 4 (GST offline tool manual, FAQ 29): no minus values are accepted. A rate and state where this
  // month's consumer credit notes exceed its sales is left out of the file (and listed for the CA).
  const b2csRows = f.b2cs.filter((r) => D(r.taxable).gte(0));
  if (b2csRows.length) {
    out.b2cs = b2csRows.map((r) =>
      r.supplyType === 'INTER'
        ? { sply_ty: 'INTER', pos: r.placeOfSupply, typ: 'OE', rt: n2(r.rate), txval: n2(r.taxable), iamt: n2(r.igst), csamt: n2(r.cess) }
        : { sply_ty: 'INTRA', pos: r.placeOfSupply, typ: 'OE', rt: n2(r.rate), txval: n2(r.taxable), camt: n2(r.cgst), samt: n2(r.sgst), csamt: n2(r.cess) },
    );
  }
  if (f.cdnr.length) {
    out.cdnr = [...byBuyer(f.cdnr)].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((x) => ({ ntty: x.noteType, nt_num: x.number, nt_dt: returnDate(x.date), val: abs2(x.value), pos: x.placeOfSupply, rchrg: x.reverseCharge ? 'Y' : 'N', inv_typ: x.invType ?? 'R', itms: itemDetails(x.items, x.interState ?? x.placeOfSupply !== sellerState, true) })),
    }));
  }
  if (f.cdnur.length) {
    out.cdnur = f.cdnur.map((x) => ({ typ: 'B2CL', ntty: x.noteType, nt_num: x.number, nt_dt: returnDate(x.date), val: abs2(x.value), pos: x.placeOfSupply, itms: itemDetails(x.items, true, true) }));
  }
  if (f.nil.length) out.nil = { inv: f.nil.map((r) => ({ sply_ty: r.supplyType, nil_amt: n2(r.nil), expt_amt: n2(r.exempt), ngsup_amt: n2(r.nonGst) })) };
  const hsnRows = (rows: Gstr1HsnRow[]) =>
    rows.map((r, i) => ({ num: ji(i + 1), hsn_sc: r.hsn, ...(r.description ? { desc: r.description.slice(0, 30) } : {}), uqc: r.uqc, qty: n2(r.quantity), rt: n2(r.rate), txval: n2(r.taxable), iamt: n2(r.igst), camt: n2(r.cgst), samt: n2(r.sgst), csamt: n2(r.cess) }));
  const plus = (rows: Gstr1HsnRow[]) => rows.filter((r) => D(r.taxable).gte(0) && D(r.quantity).gte(0));
  const hsnB2b = plus(f.hsnBusiness);
  const hsnB2c = plus(f.hsnConsumer);
  if (hsnB2b.length || hsnB2c.length) out.hsn = { ...(hsnB2b.length ? { hsn_b2b: hsnRows(hsnB2b) } : {}), ...(hsnB2c.length ? { hsn_b2c: hsnRows(hsnB2c) } : {}) };
  if (f.documents.length) {
    const natures = [...new Set(f.documents.map((d) => d.nature))].sort((a, b) => a - b);
    out.doc_issue = {
      doc_det: natures.map((nature) => ({
        doc_num: ji(nature),
        doc_typ: DOCUMENT_NATURES[nature],
        docs: f.documents.filter((d) => d.nature === nature).map((d, i) => ({ num: ji(i + 1), from: d.from, to: d.to, totnum: ji(d.total), cancel: ji(d.cancelled), net_issue: ji(d.net) })),
      })),
    };
  }
  return out;
}
