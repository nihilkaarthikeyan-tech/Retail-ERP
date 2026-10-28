// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoice and e-way bill files (plan 08 §4; decisions 57, 58, 63; scenario 8.10).
// We produce the government's own file formats and read the portal's answers
// back in; a direct provider connection is a later step (decision 63).
//
// Official sources (the only sources used):
// - E-invoice schema, bulk sample JSON (an array of invoices), validations and
//   calculations: "E-Invoice Attributes, JSON Schema & Sample JSON File",
//   https://einvoice1.gst.gov.in/Documents/EINVOICE_SCHEMA.xlsx (linked from
//   https://einvoice1.gst.gov.in/Others/BulkGenerationTools), and the field list at
//   https://einv-apisandbox.nic.in/version1.03/generate-irn.html (Version "1.1").
// - IRN cancellation within 24 hours, reasons 1–4:
//   https://einv-apisandbox.nic.in/version1.03/cancel-irn.html
// - Bulk result files (JSON: Status, IRN, Signed QR Code, Ack No., Ack Date;
//   CSV columns Document No., Ack No., Ack Date, IRN, Status, Signed QR Code;
//   failures: Seller GSTIN, IRN Number, Error Code, Error Description) and the
//   1 MB upload limit: https://einvoice6.gst.gov.in/content/kb/bulk-generation-cancellation/
// - 30-day reporting limit for ₹10 crore and above:
//   https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/
// - E-way bill bulk JSON ({ version, billLists: [...] }, attributes version 1.0.0621),
//   master codes and validations: https://docs.ewaybillgst.gov.in/Documents/bulkewb/EWB_Attributes_new.xlsx
//   (linked from https://docs.ewaybillgst.gov.in/html/formatdownloadnew.html).
// - 250 lines at most, 180-day document age, distance up to 4000 km:
//   https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html
// - Validity ends at midnight; cancellation within 24 hours: https://docs.ewaybillgst.gov.in/html/faq.html
//   One day per 200 km or part (Notification 94/2020-Central Tax, decision 58).
import { z } from 'zod';
import { daysBetween } from './accounting.js';
import { endOfBusinessDay } from './business-date.js';
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);

// ---- Limits from the official pages ----

export const EINVOICE_SCHEMA_VERSION = '1.1';
export const EINVOICE_MAX_LINES = 1000;
export const EINVOICE_CANCEL_HOURS = 24;
/** ₹10 crore and above must report within 30 days of the invoice date. */
export const EINVOICE_REPORTING_DAYS = 30;
/** Our own warning window: "near the limit" when this many days or fewer are left. */
export const EINVOICE_NEAR_LIMIT_DAYS = 5;
/** Bulk upload file size limit on the portal. */
export const PORTAL_UPLOAD_MAX_BYTES = 1_000_000;
export const EWAY_BULK_VERSION = '1.0.0621';
export const EWAY_MAX_LINES = 250;
export const EWAY_MAX_DOCUMENT_AGE_DAYS = 180;
export const EWAY_MAX_DISTANCE_KM = 4000;
export const EWAY_KM_PER_DAY = 200;
export const EWAY_CANCEL_HOURS = 24;

export const EINVOICE_STATUSES = ['waiting', 'registered', 'failed', 'cancelled'] as const;
export type EInvoiceStatus = (typeof EINVOICE_STATUSES)[number];
export const EWAY_STATUSES = ['draft', 'generated', 'cancelled', 'expired'] as const;
export type EWayStatus = (typeof EWAY_STATUSES)[number];

/** Turnover bands (GstSettings.turnoverBand) that have the 30-day reporting limit. */
export const THIRTY_DAY_BANDS = ['above_10cr', 'above_500cr'];

// ---- Dates ----

/** YYYY-MM-DD → DD/MM/YYYY, the portals' date format. */
export function toPortalDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Reads a date or date-time from a portal file, as Indian time: "2020-08-05 15:18:00",
 * "05/08/2020 03:18:00 PM", "26/09/2018 12.00:00 PM", "05/08/2020" or an ISO instant.
 */
export function parsePortalDateTime(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return new Date(s);
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/.exec(s);
  let y: string, mo: string, d: string, h = '0', mi = '0', sec = '0', ampm: string | undefined;
  if (m) [, y, mo, d, h = '0', mi = '0', sec = '0'] = m;
  else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
    if (!m) return null;
    [, d, mo, y, h = '0', mi = '0', sec = '0', ampm] = m;
  }
  let hour = Number(h);
  if (ampm) {
    if (/pm/i.test(ampm) && hour < 12) hour += 12;
    if (/am/i.test(ampm) && hour === 12) hour = 0;
  }
  const pad = (v: string | number) => String(v).padStart(2, '0');
  const out = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(mi)}:${pad(sec)}+05:30`);
  return Number.isNaN(out.getTime()) ? null : out;
}

// ---- E-way bill rules ----

/** One day for each 200 km or part of it (decision 58); at least one day. */
export function eWayValidityDays(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new Error('Distance must be zero or more kilometres');
  return Math.max(1, Math.ceil(distanceKm / EWAY_KM_PER_DAY));
}

/**
 * When an e-way bill stops being valid: each day ends at midnight, and the first
 * day ends at the midnight after the day it was made (official FAQ examples).
 * Returned as the last instant of the last valid Indian date (23:59:59 IST).
 */
export function eWayValidUntil(generatedAt: Date, distanceKm: number, generatedOn?: string): Date {
  const day = generatedOn ?? new Date(generatedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return new Date(endOfBusinessDay(addDays(day, eWayValidityDays(distanceKm))).getTime() - 1000);
}

export interface EWayValueLine {
  /** Line value including tax. Minus on returns is not expected here. */
  total: DecimalInput;
  /** Exempt goods are left out of the value. */
  exempt?: boolean;
  /** Freight (e.g. the home-delivery charge) is left out of the value. */
  freight?: boolean;
}

/** Consignment value: invoice value including tax, less exempt goods and freight (official FAQ). */
export function eWayValue(lines: EWayValueLine[]): Decimal {
  return roundMoney(lines.filter((l) => !l.exempt && !l.freight).reduce((s, l) => s.add(D(l.total)), new Decimal(0)));
}

export interface EWayLimitInput {
  fromState: string;
  toState: string;
  /** The other-state limit (GstSettings.eWayLimit). */
  limit: DecimalInput;
  /** Same-state limits by state code, where a state sets its own. */
  stateLimits?: Record<string, DecimalInput | null | undefined> | null;
}

/** The limit that applies: other state → the general limit; same state → that state's own limit if set, else the general one. */
export function eWayLimitFor(input: EWayLimitInput): Decimal {
  if (input.fromState !== input.toState) return D(input.limit);
  const own = input.stateLimits?.[input.fromState];
  return own !== null && own !== undefined && String(own) !== '' ? D(own) : D(input.limit);
}

/** An e-way bill is needed when the value is above the limit. */
export function eWayRequired(value: DecimalInput, input: EWayLimitInput): boolean {
  return D(value).gt(eWayLimitFor(input));
}

/** Plain-English problems that stop an e-way bill being made from a document; empty when fine. */
export function eWayDocumentProblems(input: { documentDate: string; today: string; lineCount: number; goodsLineCount: number; distanceKm?: number | null }): string[] {
  const out: string[] = [];
  if (daysBetween(input.documentDate, input.today) > EWAY_MAX_DOCUMENT_AGE_DAYS) out.push(`The document is more than ${EWAY_MAX_DOCUMENT_AGE_DAYS} days old; the portal refuses e-way bills for it`);
  if (input.lineCount > EWAY_MAX_LINES) out.push(`The document has ${input.lineCount} lines; an e-way bill takes at most ${EWAY_MAX_LINES}`);
  if (input.goodsLineCount === 0) out.push('The document has only services; an e-way bill needs goods');
  if (input.distanceKm !== null && input.distanceKm !== undefined && (input.distanceKm < 0 || input.distanceKm > EWAY_MAX_DISTANCE_KM)) out.push(`The distance must be between 0 and ${EWAY_MAX_DISTANCE_KM} km`);
  return out;
}

// ---- E-invoice rules ----

/** Registration can be cancelled within 24 hours of the acknowledgement. */
export function eInvoiceCancellable(registeredAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!registeredAt && now.getTime() - registeredAt.getTime() <= EINVOICE_CANCEL_HOURS * 3_600_000;
}

/** The last day to register an invoice under the 30-day limit. */
export function eInvoiceLastDay(documentDate: string): string {
  return addDays(documentDate, EINVOICE_REPORTING_DAYS);
}

/** Waiting or failed invoices of a ₹10 crore+ business with five days or fewer left (or already late). */
export function eInvoiceNearLimit(input: { status: string; documentDate: string; today: string; turnoverBand: string }): boolean {
  if (input.status !== 'waiting' && input.status !== 'failed') return false;
  if (!THIRTY_DAY_BANDS.includes(input.turnoverBand)) return false;
  return daysBetween(input.today, eInvoiceLastDay(input.documentDate)) <= EINVOICE_NEAR_LIMIT_DAYS;
}

/** Document numbers the portal accepts: up to 16 of A–Z, 0–9, / and -, not starting with 0, / or -. */
export function eInvoiceNumberProblem(number: string): string | null {
  if (number.length < 1 || number.length > 16) return 'The document number must be 1 to 16 characters for the portal';
  if (!/^[A-Z1-9][A-Z0-9/-]*$/.test(number)) return 'The document number may use only capital letters, digits, / and -, and must not start with 0, / or -';
  return null;
}

// ---- Unit quantity codes (UQC), from the official master codes list ----

export const UQC_CODES = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS'] as const;

const UQC_ALIASES: Record<string, string> = {
  KG: 'KGS', KGM: 'KGS', G: 'GMS', GM: 'GMS', GRAM: 'GMS', L: 'LTR', LT: 'LTR', LITRE: 'LTR', ML: 'MLT', M: 'MTR', MT: 'MTR', METRE: 'MTR', CM: 'CMS',
  PC: 'PCS', PIECE: 'PCS', EA: 'NOS', EACH: 'NOS', NO: 'NOS', NOS: 'NOS', PAIR: 'PRS', PR: 'PRS', DZ: 'DOZ', DOZEN: 'DOZ', PKT: 'PAC', PACK: 'PAC', BOTTLE: 'BTL', TAB: 'TBS', ROLL: 'ROL',
};

/** Our unit code → the official unit quantity code; "OTH" (others) when there is no match. */
export function uqcFor(unitCode: string | null | undefined): string {
  const c = (unitCode ?? '').trim().toUpperCase();
  if ((UQC_CODES as readonly string[]).includes(c)) return c;
  return UQC_ALIASES[c] ?? 'OTH';
}

// ---- JSON with exact decimals (money never becomes a floating-point number) ----

/** A number written into JSON exactly as its decimal text, never through a float. */
export class JsonNumber {
  constructor(readonly text: string) {}
}

/** Money with two places, as a JSON number. */
export const jm = (v: DecimalInput) => new JsonNumber(roundMoney(v).toFixed());
/** A quantity or rate with up to three places, as a JSON number. */
export const jq = (v: DecimalInput) => new JsonNumber(D(v).toDecimalPlaces(3).toFixed());
export const ji = (v: number) => new JsonNumber(String(Math.trunc(v)));

/** JSON.stringify that writes JsonNumber values as bare numbers. */
export function stringifyPortalJson(value: unknown, indent = 2): string {
  const marks: string[] = [];
  const text = JSON.stringify(
    value,
    (_k, v) => {
      if (v instanceof JsonNumber) {
        marks.push(v.text);
        return `\u0000N${marks.length - 1}\u0000`;
      }
      return v;
    },
    indent,
  );
  return text.replace(/"\\u0000N(\d+)\\u0000"/g, (_m, i: string) => marks[Number(i)]);
}

// ---- E-invoice JSON (one invoice; the bulk file is an array of these) ----

export interface PortalAddress {
  addr1: string;
  addr2?: string | null;
  place: string;
  pincode: string | null;
  stateCode: string;
}

export interface EInvoiceSource {
  typ: 'INV' | 'CRN' | 'DBN';
  number: string;
  date: string;
  /** Audit 4 (28 October 2026): the buyer's tax situation is "reverse_charge" (RegRev "Y"). */
  reverseCharge?: boolean;
  /** Audit 4 (28 October 2026): the buyer is a special economic zone unit or developer (tax situation "sez"). */
  sez?: boolean;
  seller: PortalAddress & { gstin: string; legalName: string; tradeName?: string | null; phone?: string | null; email?: string | null };
  buyer: PortalAddress & { gstin: string; legalName: string; placeOfSupply: string; phone?: string | null; email?: string | null };
  lines: { description: string; isService: boolean; hsn: string; barcode?: string | null; quantity: DecimalInput; unit: string; taxable: DecimalInput; gstRate: DecimalInput; igst: DecimalInput; cgst: DecimalInput; sgst: DecimalInput; cess?: DecimalInput; cessRate?: DecimalInput }[];
  roundOff: DecimalInput;
  total: DecimalInput;
  /** Credit and debit notes: the original invoice. */
  original?: { number: string; date: string } | null;
}

const text = (v: string | null | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);
const pinNumber = (pin: string | null) => (pin && /^[1-9][0-9]{5}$/.test(pin) ? ji(Number(pin)) : null);

/**
 * Audit 4 (28 October 2026): an optional text field within the official minimum and maximum
 * length (field list, generate-irn page); shorter than the minimum it is sent as null, because
 * the portal refuses a too-short value but accepts the field left out.
 */
export const optionalText = (v: string | null | undefined, min: number, max: number) => {
  const t = text(v, max);
  return t && t.length >= min ? t : null;
};

/** Official field lengths (https://einv-apisandbox.nic.in/version1.03/generate-irn.html, read 28 October 2026). */
export const EINVOICE_FIELD_LENGTHS = {
  LglNm: [3, 100],
  TrdNm: [3, 100],
  Addr1: [1, 100],
  Addr2: [3, 100],
  SellerLoc: [3, 50],
  BuyerLoc: [3, 100],
  Em: [6, 100],
  PrdDesc: [3, 300],
  Barcde: [3, 30],
} as const satisfies Record<string, readonly [number, number]>;

/** The official GSTIN pattern of the field list: 2 digits, then 13 of 0–9 and A–Z. */
export const EINVOICE_GSTIN_RE = /^[0-9]{2}[0-9A-Z]{13}$/;

/**
 * HSN on an e-invoice (audit 4, 28 October 2026). Goods: 6 or 8 digits. Notification
 * 78/2020-Central Tax requires 6 digits above ₹5 crore turnover, and only businesses above
 * ₹5 crore e-invoice, so the e-invoice system blocks 4-digit goods codes. Services (SAC): 4, 6
 * or 8 digits as the schema says. Never all zeros.
 */
export function eInvoiceHsnOk(hsn: string, isService: boolean): boolean {
  if (/^0+$/.test(hsn)) return false;
  return isService ? /^[0-9]{4}([0-9]{2}){0,2}$/.test(hsn) : /^[0-9]{6}([0-9]{2})?$/.test(hsn);
}

const hasTax = (s: EInvoiceSource) => s.lines.some((l) => !D(l.igst).isZero() || !D(l.cgst).isZero() || !D(l.sgst).isZero());

/**
 * SupTyp (audit 4, 28 October 2026). A supply to a special economic zone is always inter-state
 * (IGST Act s.7(5)(b); field list validation 32): "SEZWP" with IGST paid, "SEZWOP" without tax
 * under a letter of undertaking. Every other business invoice is "B2B".
 */
export function eInvoiceSupplyType(s: Pick<EInvoiceSource, 'sez' | 'lines'>): 'B2B' | 'SEZWP' | 'SEZWOP' {
  if (!s.sez) return 'B2B';
  return hasTax(s as EInvoiceSource) ? 'SEZWP' : 'SEZWOP';
}

/** Problems that would make the portal refuse the invoice; checked before a file is made. */
export function eInvoiceProblems(s: EInvoiceSource): string[] {
  const out: string[] = [];
  const bill = `Bill ${s.number}`;
  const tooShort = (label: string, field: string, v: string | null | undefined, [min, max]: readonly [number, number]) => {
    const len = (v ?? '').trim().length;
    if (len < min) out.push(`${bill}: the ${label} (${field}) must be at least ${min} character${min === 1 ? '' : 's'} (${min} to ${max}); it is ${len ? `"${(v ?? '').trim()}"` : 'empty'}`);
  };
  const numberProblem = eInvoiceNumberProblem(s.number);
  if (numberProblem) out.push(numberProblem);
  // GSTINs (audit 4): the seller's is always a real GSTIN; a business or SEZ invoice needs the buyer's too
  // ("URP" is allowed only for exports, which we do not make).
  if (!EINVOICE_GSTIN_RE.test(s.seller.gstin ?? '')) out.push(`${bill}: the seller GSTIN (Gstin) "${s.seller.gstin ?? ''}" is not a valid GSTIN`);
  if (!(s.buyer.gstin ?? '').trim()) out.push(`${bill}: the buyer GSTIN (Gstin) is missing; a business invoice needs the buyer's GSTIN`);
  else if (!EINVOICE_GSTIN_RE.test(s.buyer.gstin)) out.push(`${bill}: the buyer GSTIN (Gstin) "${s.buyer.gstin}" is not a valid GSTIN`);
  tooShort('seller legal name', 'LglNm', s.seller.legalName, EINVOICE_FIELD_LENGTHS.LglNm);
  if (!s.seller.addr1?.trim()) out.push('The seller address (GST registration or store) is missing');
  if ((s.seller.place ?? '').trim().length < 3) out.push(`${bill}: the seller town or city (Loc) is missing or shorter than 3 letters`);
  if (!pinNumber(s.seller.pincode)) out.push('The seller PIN code is missing');
  if ((s.buyer.legalName ?? '').trim().length < 3) out.push(`${bill}: the buyer name (LglNm) must be at least 3 letters`);
  if (!s.buyer.addr1?.trim()) out.push('The buyer address is missing');
  if ((s.buyer.place ?? '').trim().length < 3) out.push(`${bill}: the buyer town or city (Loc) is missing or shorter than 3 letters`);
  if (s.buyer.gstin && s.buyer.gstin.slice(0, 2) !== s.buyer.stateCode) out.push('The buyer state must match the first two digits of the buyer GSTIN');
  if (s.lines.length === 0) out.push('There are no lines');
  if (s.lines.length > EINVOICE_MAX_LINES) out.push(`An e-invoice takes at most ${EINVOICE_MAX_LINES} lines`);
  s.lines.forEach((l, i) => {
    if (!eInvoiceHsnOk(l.hsn, l.isService)) out.push(l.isService ? `${bill}, line ${i + 1}: the service code (SAC) must be 4, 6 or 8 digits` : `${bill}, line ${i + 1}: the HSN code "${l.hsn}" must be 6 or 8 digits for goods on an e-invoice (the portal blocks 4-digit codes)`);
    tooShort(`product description on line ${i + 1}`, 'PrdDesc', l.description, EINVOICE_FIELD_LENGTHS.PrdDesc);
    // SEZ (IGST Act s.7(5)(b); field list item validation 9): IGST only, even inside the seller's own state.
    if (s.sez && (!D(l.cgst).isZero() || !D(l.sgst).isZero())) out.push(`${bill}, line ${i + 1}: a supply to an SEZ is always inter-state, so it must carry IGST, not CGST and SGST; correct the bill`);
  });
  if (D(s.roundOff).abs().gt(99.99)) out.push('The rounding is more than ₹99.99');
  return out;
}

/** The invoice in the notified e-invoice schema (version 1.1). Amounts are positive, also on credit notes. */
export function buildEInvoiceJson(s: EInvoiceSource): Record<string, unknown> {
  const abs = (v: DecimalInput | undefined) => D(v ?? 0).abs();
  const lines = s.lines.map((l, i) => {
    const qty = abs(l.quantity);
    const taxable = roundMoney(abs(l.taxable));
    const igst = roundMoney(abs(l.igst));
    const cgst = roundMoney(abs(l.cgst));
    const sgst = roundMoney(abs(l.sgst));
    const cess = roundMoney(abs(l.cess));
    // Our till prices include tax, and discounts are already inside the taxable value,
    // so the gross amount is the taxable value and the unit price is its share per unit.
    const unitPrice = qty.isZero() ? taxable : taxable.div(qty).toDecimalPlaces(3);
    return {
      SlNo: String(i + 1),
      PrdDesc: text(l.description, 300),
      IsServc: l.isService ? 'Y' : 'N',
      HsnCd: l.hsn,
      Barcde: optionalText(l.barcode, ...EINVOICE_FIELD_LENGTHS.Barcde),
      Qty: jq(qty),
      FreeQty: ji(0),
      Unit: l.isService ? null : l.unit,
      UnitPrice: jq(unitPrice),
      TotAmt: jm(taxable),
      Discount: ji(0),
      AssAmt: jm(taxable),
      GstRt: jq(l.gstRate),
      IgstAmt: jm(igst),
      CgstAmt: jm(cgst),
      SgstAmt: jm(sgst),
      CesRt: jq(l.cessRate ?? 0),
      CesAmt: jm(cess),
      CesNonAdvlAmt: ji(0),
      StateCesRt: ji(0),
      StateCesAmt: ji(0),
      StateCesNonAdvlAmt: ji(0),
      OthChrg: ji(0),
      TotItemVal: jm(taxable.add(igst).add(cgst).add(sgst).add(cess)),
      _sum: { taxable, igst, cgst, sgst, cess },
    };
  });
  const sum = (k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess') => lines.reduce((t, l) => t.add(l._sum[k]), new Decimal(0));
  const roundOff = roundMoney(s.typ === 'INV' ? D(s.roundOff) : D(s.roundOff).neg());
  return {
    Version: EINVOICE_SCHEMA_VERSION,
    // Audit 4 (28 October 2026): SEZ is SEZWP/SEZWOP. IgstOnIntra stays "N" also for an SEZ in the seller's own
    // state: the field list treats SEZ as always inter-state (validation 32), while "Y" is for an intra-state
    // supply charged to IGST and then demands reverse charge (validations 29 to 31).
    TranDtls: { TaxSch: 'GST', SupTyp: eInvoiceSupplyType(s), RegRev: s.reverseCharge ? 'Y' : 'N', EcmGstin: null, IgstOnIntra: 'N' },
    DocDtls: { Typ: s.typ, No: s.number, Dt: toPortalDate(s.date) },
    SellerDtls: {
      Gstin: s.seller.gstin,
      LglNm: text(s.seller.legalName, 100),
      TrdNm: optionalText(s.seller.tradeName, ...EINVOICE_FIELD_LENGTHS.TrdNm),
      Addr1: text(s.seller.addr1, 100),
      Addr2: optionalText(s.seller.addr2, ...EINVOICE_FIELD_LENGTHS.Addr2),
      Loc: text(s.seller.place, 50),
      Pin: pinNumber(s.seller.pincode),
      Stcd: s.seller.stateCode,
      Ph: s.seller.phone && /^[0-9]{6,12}$/.test(s.seller.phone) ? s.seller.phone : null,
      Em: optionalText(s.seller.email, ...EINVOICE_FIELD_LENGTHS.Em),
    },
    BuyerDtls: {
      Gstin: s.buyer.gstin,
      LglNm: text(s.buyer.legalName, 100),
      TrdNm: null,
      Pos: s.buyer.placeOfSupply,
      Addr1: text(s.buyer.addr1, 100),
      Addr2: optionalText(s.buyer.addr2, ...EINVOICE_FIELD_LENGTHS.Addr2),
      Loc: text(s.buyer.place, 100),
      Pin: pinNumber(s.buyer.pincode),
      Stcd: s.buyer.stateCode,
      Ph: s.buyer.phone && /^[0-9]{6,12}$/.test(s.buyer.phone) ? s.buyer.phone : null,
      Em: optionalText(s.buyer.email, ...EINVOICE_FIELD_LENGTHS.Em),
    },
    DispDtls: null,
    ShipDtls: null,
    ItemList: lines.map(({ _sum, ...l }) => l),
    ValDtls: {
      AssVal: jm(sum('taxable')),
      CgstVal: jm(sum('cgst')),
      SgstVal: jm(sum('sgst')),
      IgstVal: jm(sum('igst')),
      CesVal: jm(sum('cess')),
      StCesVal: ji(0),
      Discount: ji(0),
      OthChrg: ji(0),
      RndOffAmt: jm(roundOff),
      TotInvVal: jm(abs(s.total)),
    },
    ...(s.original ? { RefDtls: { PrecDocDtls: [{ InvNo: s.original.number, InvDt: toPortalDate(s.original.date) }] } } : {}),
  };
}

// ---- E-way bill bulk JSON ----

export const EWAY_SUB_SUPPLY = { supply: 1, own_use: 5, others: 8 } as const;

export interface EWaySource {
  userGstin: string;
  subSupplyType: number;
  subSupplyDesc?: string | null;
  docType: 'INV' | 'BIL' | 'CHL' | 'OTH';
  number: string;
  date: string;
  from: PortalAddress & { gstin: string; name: string };
  to: PortalAddress & { gstin: string; name: string };
  lines: { name: string; hsn: string; quantity: DecimalInput; unit: string; taxable: DecimalInput; cgstRate: DecimalInput; sgstRate: DecimalInput; igstRate: DecimalInput; cessRate?: DecimalInput }[];
  totals: { taxable: DecimalInput; cgst: DecimalInput; sgst: DecimalInput; igst: DecimalInput; cess?: DecimalInput; other?: DecimalInput; total: DecimalInput };
  distanceKm: number;
  transporterId?: string | null;
  transporterName?: string | null;
  vehicleNo?: string | null;
}

/**
 * Audit 4 (28 October 2026): Part B is the vehicle. With only Part A (a transporter id, no
 * vehicle number) the portal gives a number but the e-way bill is not valid for movement and
 * has no validity yet; validity starts when Part B is filled in.
 */
export const EWAY_PART_B_MISSING = 'Part B (vehicle) not yet filled: the goods cannot move on it';

/** True when the e-way bill has no vehicle number yet (Part A only). */
export function eWayPartBMissing(vehicleNo: string | null | undefined): boolean {
  return !(vehicleNo ?? '').replace(/[\s-]/g, '');
}

/** Problems that stop the e-way bill file being made. */
export function eWaySourceProblems(s: EWaySource): string[] {
  const out: string[] = [];
  if (!pinNumber(s.from.pincode)) out.push('The dispatch PIN code is missing');
  if (!pinNumber(s.to.pincode)) out.push('The delivery PIN code is missing');
  if (!/^[0-9]{1,2}$/.test(s.to.stateCode)) out.push('The delivery state is missing');
  if (!s.transporterId && !s.vehicleNo) out.push('Give the transporter id or the vehicle number');
  if (s.lines.length === 0) out.push('There are no goods lines');
  return out;
}

/** One bill for the bulk file, in the official attribute names. */
export function buildEWayBill(s: EWaySource): Record<string, unknown> {
  const hsnOf = (h: string) => h.replace(/\D/g, '').slice(0, 8);
  const lines = s.lines.map((l, i) => ({
    itemNo: ji(i + 1),
    productName: text(l.name, 100) ?? '',
    productDesc: text(l.name, 100) ?? '',
    hsnCode: hsnOf(l.hsn),
    quantity: jq(D(l.quantity).abs()),
    qtyUnit: l.unit,
    taxableAmount: jm(D(l.taxable).abs()),
    sgstRate: jq(l.sgstRate),
    cgstRate: jq(l.cgstRate),
    igstRate: jq(l.igstRate),
    cessRate: jq(l.cessRate ?? 0),
    cessNonAdvol: ji(0),
  }));
  // The main HSN is the one of the line with the highest taxable value.
  const main = [...s.lines].sort((a, b) => D(b.taxable).abs().cmp(D(a.taxable).abs()))[0];
  return {
    userGstin: s.userGstin,
    supplyType: 'O',
    subSupplyType: ji(s.subSupplyType),
    subSupplyDesc: s.subSupplyDesc ?? '',
    docType: s.docType,
    docNo: s.number,
    docDate: toPortalDate(s.date),
    transType: ji(1),
    fromGstin: s.from.gstin,
    fromTrdName: text(s.from.name, 100) ?? '',
    fromAddr1: text(s.from.addr1, 120) ?? '',
    fromAddr2: text(s.from.addr2, 120) ?? '',
    fromPlace: text(s.from.place, 50) ?? '',
    fromPincode: pinNumber(s.from.pincode),
    fromStateCode: ji(Number(s.from.stateCode)),
    actualFromStateCode: ji(Number(s.from.stateCode)),
    toGstin: s.to.gstin,
    toTrdName: text(s.to.name, 100) ?? '',
    toAddr1: text(s.to.addr1, 120) ?? '',
    toAddr2: text(s.to.addr2, 120) ?? '',
    toPlace: text(s.to.place, 50) ?? '',
    toPincode: pinNumber(s.to.pincode),
    toStateCode: ji(Number(s.to.stateCode)),
    actualToStateCode: ji(Number(s.to.stateCode)),
    totalValue: jm(D(s.totals.taxable).abs()),
    cgstValue: jm(D(s.totals.cgst).abs()),
    sgstValue: jm(D(s.totals.sgst).abs()),
    igstValue: jm(D(s.totals.igst).abs()),
    cessValue: jm(D(s.totals.cess ?? 0).abs()),
    TotNonAdvolVal: ji(0),
    OthValue: jm(D(s.totals.other ?? 0)),
    totInvValue: jm(D(s.totals.total).abs()),
    transMode: ji(1),
    transDistance: ji(s.distanceKm),
    transporterName: text(s.transporterName, 100) ?? '',
    transporterId: s.transporterId ?? '',
    transDocNo: '',
    transDocDate: '',
    vehicleNo: (s.vehicleNo ?? '').replace(/[\s-]/g, '').toUpperCase(),
    vehicleType: 'R',
    mainHsnCode: main ? hsnOf(main.hsn) : '',
    itemList: lines,
  };
}

/** The bulk upload file: { version, billLists: [...] }. */
export function eWayBulkFile(bills: Record<string, unknown>[]): string {
  return stringifyPortalJson({ version: EWAY_BULK_VERSION, billLists: bills });
}

// ---- Reading the portals' answer files ----

/** Flattens nested keys and lower-cases them without punctuation: "DocDtls.No" → "docdtlsno", "Ack No." → "ackno". */
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + norm(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else {
      if (!(key in out)) out[key] = v;
      if (prefix && !(norm(k) in out)) out[norm(k)] = v;
    }
  }
  return out;
}

/** Splits CSV text into rows of cells (quotes and doubled quotes handled). */
export function parseCsv(textIn: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = textIn.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** Records from a JSON or CSV answer file, keys normalised. */
function records(fileText: string): Record<string, unknown>[] {
  const t = fileText.replace(/^\uFEFF/, '').trim();
  if (!t) return [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const data = JSON.parse(t) as unknown;
    const out: Record<string, unknown>[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      const flat = flatten(o);
      const isRecord = ['irn', 'ackno', 'signedqrcode', 'ewaybillno', 'ewbno', 'errorcode', 'errormessage', 'docno', 'documentno'].some((k) => k in flat) || Object.keys(o).some((k) => /^errordetails$/i.test(k));
      if (!isRecord) {
        // Containers such as { Data: [...] } or { billLists: [...] } are opened up.
        for (const x of Object.values(o)) if (x && typeof x === 'object') walk(x);
        return;
      }
      const errors = Object.entries(o).find(([k, x]) => /error/i.test(k) && Array.isArray(x)) as [string, Record<string, unknown>[]] | undefined;
      if (errors) {
        flat.errorcode = errors[1].map((e) => e.ErrorCode ?? e.errorCode ?? '').filter(Boolean).join(', ');
        flat.errormessage = errors[1].map((e) => e.ErrorMessage ?? e.errorMessage ?? '').filter(Boolean).join('; ');
      }
      out.push(flat);
    };
    walk(data);
    return out;
  }
  const rows = parseCsv(t);
  if (rows.length < 2) return [];
  const head = rows[0].map(norm);
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const pick = (r: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
};

/** Reads the claims of a signed QR code or signed invoice (a JWT); the invoice details sit in its "data" claim. */
export function signedPayload(jwt: string | null | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json) as Record<string, unknown>;
    const data = typeof claims.data === 'string' ? (JSON.parse(claims.data) as Record<string, unknown>) : (claims.data as Record<string, unknown> | undefined);
    return { ...claims, ...(data ?? {}) };
  } catch {
    return null;
  }
}

export interface EInvoiceResult {
  documentNumber: string | null;
  documentType: string | null;
  /** Audit 4 (28 October 2026): with type and date, so the answer is matched to the right invoice. */
  sellerGstin: string | null;
  /** The invoice date as YYYY-MM-DD (Indian date). */
  documentDate: string | null;
  irn: string | null;
  ackNumber: string | null;
  ackDate: Date | null;
  signedQr: string | null;
  /** registered, cancelled or failed. */
  outcome: 'registered' | 'cancelled' | 'failed';
  error: string | null;
  cancelledAt: Date | null;
}

/** A portal date ("18/10/2026" or "2026-10-18") as YYYY-MM-DD; null when it is not a date. */
function portalDay(v: string | null): string | null {
  const d = parsePortalDateTime(v);
  return d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
}

/** Reads the e-invoice portal's result file (JSON or CSV): generated IRNs, cancellations and errors. */
export function parseEInvoiceResults(fileText: string): EInvoiceResult[] {
  return records(fileText).map((r) => {
    const signedQr = pick(r, ['signedqrcode', 'signedqr']);
    const signedInvoice = pick(r, ['signedinvoice']);
    const claims = signedPayload(signedQr) ?? signedPayload(signedInvoice);
    const fromClaims = (k: string) => (claims ? pick(Object.fromEntries(Object.entries(claims).map(([a, b]) => [norm(a), b])), [k]) : null);
    const documentNumber = pick(r, ['docno', 'documentno', 'documentnumber', 'docdtlsno', 'invoiceno']) ?? fromClaims('docno');
    const irn = pick(r, ['irn', 'irnnumber']) ?? fromClaims('irn');
    const status = (pick(r, ['status', 'irnstatus']) ?? '').toUpperCase();
    const errorCode = pick(r, ['errorcode']);
    const errorText = pick(r, ['errormessage', 'errordescription', 'errordetails', 'error']);
    const cancelledAt = parsePortalDateTime(pick(r, ['canceldate', 'irncanceldate', 'cnldt']));
    const failed = !!errorCode || !!errorText || status === '0' || status === 'FAILED' || status === 'ERROR';
    const cancelled = !failed && (status === 'CNL' || status === 'CANCELLED' || !!cancelledAt);
    return {
      documentNumber,
      documentType: (pick(r, ['documenttype', 'doctyp', 'docdtlstyp', 'typ']) ?? fromClaims('doctyp'))?.toUpperCase() ?? null,
      sellerGstin: (pick(r, ['sellergstin', 'sellerdtlsgstin', 'suppliergstin']) ?? fromClaims('sellergstin'))?.toUpperCase() ?? null,
      documentDate: portalDay(pick(r, ['documentdate', 'docdate', 'docdtlsdt', 'docdt']) ?? fromClaims('docdt')),
      irn,
      ackNumber: pick(r, ['ackno', 'acknowledgementno', 'acknumber']),
      ackDate: parsePortalDateTime(pick(r, ['ackdt', 'ackdate', 'acknowledgementdate'])),
      signedQr,
      outcome: failed ? 'failed' : cancelled ? 'cancelled' : 'registered',
      error: failed ? [errorCode, errorText].filter(Boolean).join(': ') || 'Refused by the portal' : null,
      cancelledAt: cancelled ? (cancelledAt ?? null) : null,
    };
  });
}

export interface EWayResult {
  documentNumber: string | null;
  number: string | null;
  generatedAt: Date | null;
  validUntil: Date | null;
  error: string | null;
}

/** Reads e-way bill numbers from a file saved from the e-way bill portal (JSON or CSV). */
export function parseEWayResults(fileText: string): EWayResult[] {
  return records(fileText).map((r) => {
    const errorText = pick(r, ['errormessage', 'errordescription', 'errorcodes', 'errorcode', 'error']);
    return {
      documentNumber: pick(r, ['docno', 'documentno', 'documentnumber']),
      number: pick(r, ['ewaybillno', 'ewbno', 'ewaybillnumber', 'ewbnumber']),
      generatedAt: parsePortalDateTime(pick(r, ['ewaybilldate', 'ewbdate', 'ewbdt', 'generateddate', 'generatedon'])),
      validUntil: parsePortalDateTime(pick(r, ['validupto', 'validuntil', 'validtill', 'ewbvalidtill'])),
      error: errorText,
    };
  });
}

// ---- Input validation (API authoritative, web forms reuse) ----

const uuid = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD form');

export const eInvoiceQuerySchema = z.object({
  status: z.enum([...EINVOICE_STATUSES, 'near_limit']).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  search: z.string().trim().max(40).optional(),
});
export type EInvoiceQuery = z.infer<typeof eInvoiceQuerySchema>;

export const eInvoiceExportSchema = z.object({
  /** The e-invoices to put in the file; none = every waiting one (up to 200). */
  ids: z.array(uuid).max(500).optional(),
});
export type EInvoiceExportInput = z.infer<typeof eInvoiceExportSchema>;

export const EINVOICE_CANCEL_REASONS = { '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Others' } as const;

export const eInvoiceCancelSchema = z.object({
  reason: z.enum(['1', '2', '3', '4']),
  remark: z.string().trim().max(100).optional(),
  /** When it was cancelled on the portal; defaults to now. */
  cancelledAt: z.string().datetime({ offset: true }).optional(),
});
export type EInvoiceCancelInput = z.infer<typeof eInvoiceCancelSchema>;

export const eInvoiceManualSchema = z.object({
  irn: z.string().trim().regex(/^[0-9a-fA-F]{64}$/, 'The IRN is 64 letters and digits'),
  ackNumber: z.string().trim().min(1).max(20),
  ackDate: z.string().trim().min(10).max(30),
  signedQr: z.string().trim().min(20).max(4000),
});
export type EInvoiceManualInput = z.infer<typeof eInvoiceManualSchema>;

export const EWAY_DOCUMENT_TYPES = ['pos_bill', 'stock_document'] as const;
export type EWayDocumentType = (typeof EWAY_DOCUMENT_TYPES)[number];

const vehicle = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || /^[A-Z0-9]{7,15}$/.test(v), 'Vehicle number: 7 to 15 letters and digits, e.g. KA12AB1234');

export const eWayDraftSchema = z.object({
  documentType: z.enum(EWAY_DOCUMENT_TYPES),
  documentId: uuid,
  distanceKm: z.coerce.number().int().min(0).max(EWAY_MAX_DISTANCE_KM),
  transporterId: z.string().trim().toUpperCase().regex(/^[0-9]{2}[0-9A-Z]{13}$/, 'Transporter id is the 15-character GSTIN or TRANSIN').optional().nullable().or(z.literal('')),
  transporterName: z.string().trim().max(100).optional().nullable(),
  vehicleNo: vehicle.optional().nullable(),
});
export type EWayDraftInput = z.infer<typeof eWayDraftSchema>;

export const eWayUpdateSchema = eWayDraftSchema.omit({ documentType: true, documentId: true }).partial();
export type EWayUpdateInput = z.infer<typeof eWayUpdateSchema>;

export const eWayGeneratedSchema = z.object({
  number: z.string().trim().regex(/^[0-9]{12}$/, 'The e-way bill number is 12 digits'),
  /** When the portal made it; defaults to now. */
  generatedAt: z.string().datetime({ offset: true }).optional(),
  /** As printed by the portal; worked out from the distance when left out. */
  validUntil: z.string().datetime({ offset: true }).optional(),
});
export type EWayGeneratedInput = z.infer<typeof eWayGeneratedSchema>;

export const eWayCancelSchema = z.object({ reason: z.string().trim().min(3).max(100) });
export type EWayCancelInput = z.infer<typeof eWayCancelSchema>;

export const eWayQuerySchema = z.object({
  status: z.enum([...EWAY_STATUSES, 'expiring']).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  search: z.string().trim().max(40).optional(),
});
export type EWayQuery = z.infer<typeof eWayQuerySchema>;

export const eWayExportSchema = z.object({ ids: z.array(uuid).min(1).max(200) });
export type EWayExportInput = z.infer<typeof eWayExportSchema>;
