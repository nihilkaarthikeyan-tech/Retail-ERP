// Copyright (c) 2026, Rademics. All rights reserved.
// GST common core (plan 08 §2, blueprint 13). Pure rules shared by the API,
// the till (online and offline) and purchases: GSTIN check character, the
// rate in force for an HSN code on a date and at a selling price, place of
// supply and tax situation, tax on a line, the consumer-details limit, the
// credit-note reporting deadline and what a printed GST document is called.
// Every rule names its official source; the CA confirms them before go-live.
import { inclusiveTax, type InclusiveTax } from './pos.js';
import { Decimal, type DecimalInput } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

export const GST_SCHEMES = ['regular', 'composition'] as const;
export type GstScheme = (typeof GST_SCHEMES)[number];
export const FILING_FREQUENCIES = ['monthly', 'quarterly'] as const;
export const TURNOVER_BANDS = ['up_to_5cr', '5cr_to_10cr', 'above_10cr', 'above_500cr'] as const;
export type TurnoverBand = (typeof TURNOVER_BANDS)[number];
export const HSN_DIGITS = [4, 6, 8] as const;
/** Decision 61: how true free samples are taxed is set by the CA. */
export const FREE_SAMPLE_TAX = ['not_set', 'reverse_input_credit', 'tax_on_value'] as const;
/** Plan 08 G3. */
export const TAX_SITUATIONS = ['regular', 'unregistered', 'sez', 'exempt', 'reverse_charge'] as const;
export type TaxSituation = (typeof TAX_SITUATIONS)[number];
/** Plan 08 G4, G5, G7. */
export const INVOICE_KINDS = ['consumer', 'business', 'bill_of_supply'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
/** Plan 08 G2: exempt and nil-rated are reported apart from a 0% rate. */
export const GST_RATE_KINDS = ['taxable', 'exempt', 'nil'] as const;
export type GstRateKind = (typeof GST_RATE_KINDS)[number];

/** The usual HSN digits for a turnover band (decision 59): 4 up to ₹5 crore, 6 above. */
export function defaultHsnDigits(band: string): 4 | 6 {
  return band === 'up_to_5cr' ? 4 : 6;
}

// ---- GSTIN ----

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The 15th (check) character of a GSTIN from its first 14: the modulus-36
 * check GSTN uses (each character's value 0–35, weights 1 and 2 by turn, the
 * digits of each product in base 36 added, check = (36 − sum mod 36) mod 36).
 * Structure of the GSTIN: 2-digit state code, PAN, entity number, "Z", check
 * character (GST portal, https://www.gst.gov.in, "GSTIN" in the help pages).
 */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    if (v < 0) throw new Error('Not a GSTIN character');
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** What is wrong with a GSTIN typed or scanned at the till, in plain words; null when it is good. */
export function gstinProblem(value: string, isStateCode?: (code: string) => boolean): string | null {
  const g = value.trim().toUpperCase();
  if (g.length !== 15) return 'A GSTIN has 15 letters and digits';
  if (!GSTIN_SHAPE.test(g)) return 'This is not a GSTIN: it should look like 33ABCDE1234F1Z7';
  if (isStateCode && !isStateCode(g.slice(0, 2))) return `The GSTIN starts with ${g.slice(0, 2)}, which is not a state code`;
  if (gstinCheckCharacter(g.slice(0, 14)) !== g[14]) return 'The GSTIN has a typing mistake: its last character does not match';
  return null;
}

export function isValidGstin(value: string): boolean {
  return gstinProblem(value) === null;
}

// ---- Rate list: by HSN, date and selling price (plan 08 G2, decision 56) ----

export interface GstRateRow {
  hsnCode: string;
  rate: DecimalInput;
  kind?: string | null;
  /** The rate applies above this value per unit, before GST (none = from nothing). Decision L7. */
  priceFrom?: DecimalInput | null;
  /** … and up to and including this one (none = no upper limit). */
  priceUpTo?: DecimalInput | null;
  /** YYYY-MM-DD. */
  effectiveFrom: string;
}

/** HSN codes to look under, longest first: 8, 6, then 4 digits. */
export function hsnLookupCodes(hsnCode: string): string[] {
  return [hsnCode.slice(0, 8), hsnCode.slice(0, 6), hsnCode.slice(0, 4)].filter((c, i, a) => c.length >= 4 && a.indexOf(c) === i);
}

/**
 * The rows in force for an HSN code on a date: the longest matching code, and
 * of it the rows with the latest start date on or before the date (one plain
 * rate, or one row per price band). Old documents keep their rate (G2).
 */
export function ratesInForce<T extends GstRateRow>(rows: T[], hsnCode: string | null | undefined, date: string): T[] {
  if (!hsnCode) return [];
  for (const code of hsnLookupCodes(hsnCode)) {
    const started = rows.filter((r) => r.hsnCode === code && r.effectiveFrom <= date);
    if (!started.length) continue;
    const latest = started.reduce((m, r) => (r.effectiveFrom > m ? r.effectiveFrom : m), started[0].effectiveFrom);
    return started.filter((r) => r.effectiveFrom === latest);
  }
  return [];
}

export function hasPriceBand(r: GstRateRow): boolean {
  return (r.priceFrom !== null && r.priceFrom !== undefined) || (r.priceUpTo !== null && r.priceUpTo !== undefined);
}

/** Whether a value per unit (before GST) falls in a row's band: above "from", up to and including "up to". */
export function inPriceBand(r: GstRateRow, unitPrice: DecimalInput): boolean {
  const p = D(unitPrice);
  if (r.priceFrom !== null && r.priceFrom !== undefined && !p.gt(D(r.priceFrom))) return false;
  if (r.priceUpTo !== null && r.priceUpTo !== undefined && p.gt(D(r.priceUpTo))) return false;
  return true;
}

/**
 * The rate for an item: in force on the date, and for price-banded HSN codes
 * (clothing, footwear) the band of the value per unit before GST.
 *
 * Decision L7 (owner, 28 October 2026): the band is the "sale value" of the
 * notification, which is the transaction value (CBIC GST rates FAQ, question 33),
 * and the transaction value does not include the GST itself (CGST Act, section 15).
 * A till price includes GST (`gstIncluded`): each band is tried with its own
 * rate taken out, lowest band first. A price that fits no band that way (between
 * the bands, for example ₹2,700 with GST for a ₹2,500 band) takes the highest
 * band's rate, so the tax is never too low.
 *
 * Without a price (or a price of nothing, such as a free unit) the lowest band
 * applies. Null when no rate is set.
 */
export function pickGstRate<T extends GstRateRow>(rows: T[], hsnCode: string | null | undefined, date: string, unitPrice?: DecimalInput | null, opts: { gstIncluded?: boolean } = {}): T | null {
  const inForce = ratesInForce(rows, hsnCode, date);
  if (!inForce.length) return null;
  const plain = inForce.find((r) => !hasPriceBand(r));
  const bands = inForce.filter(hasPriceBand).sort((a, b) => D(a.priceFrom ?? -1).cmp(D(b.priceFrom ?? -1)));
  if (!bands.length) return plain ?? inForce[0];
  if (unitPrice !== null && unitPrice !== undefined) {
    const before = (r: T) => (opts.gstIncluded ? D(unitPrice).div(D(1).add(D(r.rate).div(100))) : D(unitPrice));
    const hit = bands.find((r) => inPriceBand(r, before(r)));
    if (hit) return hit;
    if (opts.gstIncluded && D(unitPrice).gt(0)) return bands.reduce((m, r) => (D(r.rate).gt(D(m.rate)) ? r : m), bands[0]);
  }
  return plain ?? bands[0];
}

/** Two bands of one HSN code and start date must not overlap; null when they do not. */
export function priceBandProblem(rows: GstRateRow[]): string | null {
  const bands = rows.filter(hasPriceBand).sort((a, b) => D(a.priceFrom ?? -1).cmp(D(b.priceFrom ?? -1)));
  for (const r of bands) {
    if (r.priceFrom != null && r.priceUpTo != null && !D(r.priceUpTo).gt(D(r.priceFrom))) return 'The "up to" price must be more than the "above" price';
  }
  for (let i = 1; i < bands.length; i++) {
    const prevTo = bands[i - 1].priceUpTo;
    const from = bands[i].priceFrom;
    if (prevTo == null || from == null || D(from).lt(D(prevTo))) return `The price bands of HSN ${bands[i].hsnCode} from ${bands[i].effectiveFrom} overlap`;
  }
  return null;
}

/** The selling price per unit that chooses the band (with `gstIncluded`): the line amount (GST included, after discounts) per basic unit. */
export function bandUnitPrice(amount: DecimalInput, basicQuantity: DecimalInput): Decimal {
  const q = D(basicQuantity).abs();
  return q.isZero() ? ZERO : D(amount).abs().div(q);
}

// ---- Place of supply and tax situation (plan 08 G1, G3) ----

/** A party's tax situation: as set, else regular with a GSTIN and unregistered without. */
export function taxSituationOf(gstin: string | null | undefined, situation: string | null | undefined): TaxSituation {
  if (situation && (TAX_SITUATIONS as readonly string[]).includes(situation)) return situation as TaxSituation;
  return gstin ? 'regular' : 'unregistered';
}

export interface SupplyInput {
  /** The state of the seller's GST registration. */
  sellerState: string;
  scheme: GstScheme | string;
  buyerGstin?: string | null;
  /** The buyer's state as written on the bill (unregistered buyers). */
  buyerState?: string | null;
  /** Where the goods are delivered (home delivery). */
  deliveryState?: string | null;
  taxSituation?: string | null;
}

export interface Supply {
  invoiceKind: InvoiceKind;
  situation: TaxSituation;
  /** State code of the place of supply. */
  placeOfSupply: string;
  /** IGST instead of CGST + SGST. */
  interState: boolean;
  /** No tax is charged: composition scheme or an exempt buyer. */
  noTax: boolean;
}

/**
 * Place of supply of goods (IGST Act section 10): where the movement of the
 * goods ends for delivery (the delivery address); for an unregistered buyer
 * the address recorded on the invoice; with no address, the seller's own
 * location. Supply is inter-state when that state differs from the seller's
 * (IGST Act section 7), and a supply to a special economic zone is always
 * inter-state (section 7(5)(b)).
 * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section10_v1.00.html
 * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteriv/section7_v1.00.html
 * Plan 08 G4: a buyer with a GSTIN (not marked unregistered) gets a business
 * tax invoice; a composition dealer issues bills of supply with no tax (G7).
 */
export function resolveSupply(i: SupplyInput): Supply {
  const gstin = i.buyerGstin?.trim().toUpperCase() || null;
  const situation = taxSituationOf(gstin, i.taxSituation);
  const registered = !!gstin && situation !== 'unregistered';
  const buyerState = registered ? gstin!.slice(0, 2) : i.buyerState || null;
  const placeOfSupply = i.deliveryState || buyerState || i.sellerState;
  const interState = situation === 'sez' || placeOfSupply !== i.sellerState;
  if (i.scheme === 'composition') return { invoiceKind: 'bill_of_supply', situation, placeOfSupply, interState, noTax: true };
  return { invoiceKind: registered ? 'business' : 'consumer', situation, placeOfSupply, interState, noTax: situation === 'exempt' };
}

/** GST inside a line amount for this supply: none on a bill of supply or to an exempt buyer. */
export function supplyLineTax(amount: DecimalInput, gstRate: DecimalInput, supply: Pick<Supply, 'interState' | 'noTax'>): InclusiveTax {
  if (supply.noTax) return { taxable: D(amount), cgst: ZERO, sgst: ZERO, igst: ZERO, tax: ZERO };
  return inclusiveTax(amount, gstRate, supply.interState);
}

// ---- Consumer bills (plan 08 G5) ----

/**
 * An unregistered buyer's name, address and state must be on the invoice when
 * the taxable value is ₹50,000 or more (CBIC invoice rules, rule 46).
 * https://cbic-gst.gov.in/gst-invoice-rules.html
 */
export const CONSUMER_DETAILS_LIMIT = '50000';

export function needsBuyerDetails(taxableValue: DecimalInput): boolean {
  return D(taxableValue).abs().gte(D(CONSUMER_DETAILS_LIMIT));
}

// ---- Credit notes (plan 08 G6) ----

/**
 * The last date a credit note can still reduce the tax of a sale: 30 November
 * after the end of the sale's financial year (CGST Act section 34(2); the
 * annual return date if earlier is a check for the CA).
 * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html
 */
export function creditNoteDeadline(saleDate: string): string {
  const y = Number(saleDate.slice(0, 4));
  const m = Number(saleDate.slice(5, 7));
  const fyEndYear = m >= 4 ? y + 1 : y;
  return `${fyEndYear}-11-30`;
}

export function isCreditNoteLate(saleDate: string, noteDate: string): boolean {
  return noteDate > creditNoteDeadline(saleDate);
}

// ---- Printing (plan 08 §2, decision 43) ----

/**
 * Words a composition dealer puts at the top of a bill of supply (CGST Rules,
 * rule 5(1)(g); CBIC invoice rules https://cbic-gst.gov.in/gst-invoice-rules.html).
 */
export const BILL_OF_SUPPLY_DECLARATION = 'Composition taxable person, not eligible to collect tax on supplies';

/** The title a till bill prints under. */
export function gstDocumentTitle(billKind: 'sale' | 'return' | string, invoiceKind: string): string {
  if (billKind === 'return') return 'Credit note';
  return invoiceKind === 'bill_of_supply' ? 'Bill of supply' : 'Tax invoice';
}

/** The HSN code printed: the configured number of digits (decision 59), never more than is stored. */
export function hsnForPrint(hsnCode: string | null | undefined, digits: number): string {
  if (!hsnCode) return '';
  return hsnCode.slice(0, Math.max(4, digits));
}

// ---- Invoice numbers (CGST Rules, rule 46(b); GSTR-1 schema) ----

/**
 * A GST invoice, credit note or delivery challan number: at most 16
 * characters, letters, digits, hyphen and slash only, unique in the financial
 * year (CBIC invoice rules, https://cbic-gst.gov.in/gst-invoice-rules.html).
 */
export const GST_INVOICE_NUMBER_MAX = 16;
const INVOICE_NUMBER_RE = /^[A-Za-z0-9/-]+$/;

export function gstNumberProblem(number: string): string | null {
  if (number.length > GST_INVOICE_NUMBER_MAX) return `${number} is longer than ${GST_INVOICE_NUMBER_MAX} characters, the most a GST invoice number may have`;
  if (!INVOICE_NUMBER_RE.test(number)) return `${number} may only have letters, digits, hyphens and slashes`;
  return null;
}

/** A till's invoice prefix: 1–4 capital letters or digits, unique in the company. */
export const TILL_INVOICE_PREFIX_RE = /^[A-Z0-9]{1,4}$/;
/** Running digits of a till bill number. */
export const TILL_NUMBER_DIGITS = 6;

/** "2026-27" → "2627" (also "2026-2027" → "2627"). */
export function shortFinancialYear(name: string): string {
  const m = /^(\d{4})-(\d{2}|\d{4})$/.exec(name.trim());
  if (m) return `${m[1].slice(2)}${m[2].slice(-2)}`;
  return name.replace(/[^0-9]/g, '').slice(-4);
}

/** Letters and digits only, in capitals. */
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Default invoice prefixes for a till, best first: the till code with the
 * start of the store code in front (MAIN + T1 → MAT1), then shorter forms.
 * The API takes the first one no other till of the company uses.
 */
export function tillInvoicePrefixCandidates(storeCode: string, tillCode: string): string[] {
  const s = alnum(storeCode);
  const t = alnum(tillCode).slice(-4);
  const out = [s.slice(0, Math.max(0, 4 - t.length)) + t, s.slice(0, 1) + t.slice(-3), t, s.slice(0, 2) + t.slice(-2), s.slice(0, 3) + t.slice(-1)];
  return [...new Set(out.filter((x) => TILL_INVOICE_PREFIX_RE.test(x)))];
}

/**
 * The start of a till's bill numbers in a financial year (pos-offline §3):
 * PREFIX/2627/ for a short invoice prefix, so PREFIX/2627/000001 is at most 16
 * characters; tills made before this keep STORE-TILL-2026-27- until their
 * prefix is set.
 */
export function tillNumberSeries(numberPrefix: string, financialYearName: string): string {
  if (TILL_INVOICE_PREFIX_RE.test(numberPrefix)) return `${numberPrefix}/${shortFinancialYear(financialYearName)}/`;
  return `${numberPrefix}-${financialYearName}-`;
}
