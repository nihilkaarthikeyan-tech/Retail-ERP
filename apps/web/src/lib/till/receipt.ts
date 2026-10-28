// Copyright (c) 2026, Rademics. All rights reserved.
// Till receipts (blueprint 16 "Till receipt"; pos-offline plan §9). The
// server's receipt data is printed as it comes; offline the till builds the
// same shape from its own figures. Printing goes to the Till Helper on this
// computer (http://127.0.0.1:47120) and falls back to the browser's print
// window with an 80 mm page, so billing never stops because of a printer.
//
// Contract agreed with the Till Helper:
//   POST /print        body { receipt }  (the API receipt + store/company header)
//   POST /drawer/open  opens the cash drawer through the printer
//   GET  /status       → { ok, printer, drawer }
//   Every request carries the header x-helper-token (paired once).
import { BILL_OF_SUPPLY_DECLARATION, Decimal, gstDocumentTitle, hsnForPrint, INDIAN_STATES } from "shared";
import { type ComputedBill, type ComputedPart, type DraftBuyer, type DraftDelivery, offersUsed } from "./pricing";
import type { Receipt, ReceiptGst, ReceiptLine, SnapPaymentMethod, SnapSalesStaff, SnapTill } from "./types";

/**
 * Audit 4 (28 October 2026): receipt fields the printed tax invoice needs beyond
 * the stored receipt shape. All optional: a receipt without them prints as before.
 * - lines[].unit: the unit code printed after the quantity (CGST Rules rule 46(i)).
 * - gst.buyerSituation: the buyer's tax situation (regular, unregistered, sez,
 *   reverse_charge); decides "Tax payable on reverse charge" (rule 46(p)) and the
 *   SEZ endorsement (rule 46, third proviso).
 * - gst.endorsement: the SEZ endorsement worked out by whoever built the receipt.
 * - taxTable: false when the business switched the GST table off; the tax is then
 *   still printed, one short line per rate (rule 46(k)-(m)), so gstTable must still
 *   carry the rows of a tax invoice or credit note.
 */
export interface PrintLine extends ReceiptLine {
  unit?: string | null;
}
export interface PrintGst extends ReceiptGst {
  buyerSituation?: string | null;
  endorsement?: string | null;
  /** The stored document kind (tax_invoice, bill_of_supply, invoice_cum_bill_of_supply, credit_note, return_note). */
  documentKind?: string | null;
}
export interface PrintReceiptData extends Omit<Receipt, "lines" | "gst"> {
  lines: PrintLine[];
  gst?: PrintGst;
  taxTable?: boolean;
  documentKind?: string | null;
  documentTitle?: string | null;
}

export { RETURN_NOTE_LINE, SEZ_UNDER_LUT, SEZ_WITH_IGST } from "shared";
import { SEZ_UNDER_LUT, SEZ_WITH_IGST } from "shared";

export const isReturnNote = (title: string | null | undefined) => (title ?? "").trim().toLowerCase() === "return note";

/** "2.5 KG", "1 PCS": the quantity with its unit when the receipt has one (rule 46(i)). */
export function quantityWithUnit(quantity: string, unit: string | null | undefined): string {
  const u = unit?.trim();
  return u ? `${quantity} ${u}` : quantity;
}

const notZero = (v: string | null | undefined) => {
  try {
    return !!v && !new Decimal(v).isZero();
  } catch {
    return false;
  }
};

/**
 * Audit 4 (28 October 2026): what the receipt prints about tax, decided once for
 * the screen receipt (the Till Helper does the same from the same fields).
 * - A tax invoice or credit note always shows its tax: as the table, or, with the
 *   table switched off, one short line per rate (rule 46(k)-(m)); a bill of supply
 *   and a return note show none.
 * - Every tax invoice says whether tax is payable on reverse charge (rule 46(p)).
 * - A supply to an SEZ carries the rule 46 third-proviso endorsement.
 */
export function receiptTaxView(r: Pick<PrintReceiptData, "kind" | "gst" | "gstTable" | "taxTable" | "documentKind" | "documentTitle">) {
  const g = r.gst ?? null;
  const returnNote = isReturnNote(g?.title) || isReturnNote(r.documentTitle) || (g?.documentKind ?? r.documentKind) === "return_note";
  const taxed = g ? !returnNote && g.invoiceKind !== "bill_of_supply" : true;
  const rows = taxed ? r.gstTable : [];
  const igst = rows.some((x) => notZero(x.igst));
  const taxInvoice = !!g && taxed && r.kind === "sale";
  const situation = g?.buyerSituation ?? null;
  const endorsement = taxInvoice ? (g?.endorsement ?? (situation === "sez" && rows.length ? (igst ? SEZ_WITH_IGST : SEZ_UNDER_LUT) : null)) : null;
  return {
    returnNote,
    /** A tax invoice or credit note (its taxable value prints even when no rows came). */
    taxed: !!g && taxed,
    rows,
    igst,
    table: rows.length > 0 && r.taxTable !== false,
    short: rows.length > 0 && r.taxTable === false,
    reverseCharge: taxInvoice ? (g!.reverseCharge || situation === "reverse_charge" ? "Yes" : "No") : null,
    endorsement,
  };
}

/** Plan 11 B4 and C1: what the till's own receipt shows about the salesperson and the delivery. */
export interface LocalReceiptExtras {
  staff?: SnapSalesStaff[];
  salesStaffId?: string | null;
  delivery?: DraftDelivery | null;
  deliveryCharge?: Decimal | null;
  /** Plan 08 G4, G5: the buyer typed on the bill (the customer's GSTIN is used when none was typed). */
  buyer?: DraftBuyer | null;
  customer?: { name: string; gstin: string | null } | null;
  /** Plan 08 G6: the bill a return is against. */
  originalNumber?: string | null;
  /** Plan 13: offline, a named customer's sale says its points are added once the bill reaches the server. */
  loyaltyNote?: { scheme: string; note: string } | null;
}

const stateOf = (code: string | null | undefined) => (code ? { code, name: INDIAN_STATES[code] ?? code } : null);

/** Plan 08: the GST part of the till's own receipt, shaped like the server's. */
function localGst(bill: ComputedBill, kind: "sale" | "return", till: SnapTill, extras: LocalReceiptExtras): PrintGst {
  const supply = bill.supply;
  const b = extras.buyer;
  const gstin = kind === "sale" ? (b?.gstin.trim().toUpperCase() || (supply.invoiceKind === "business" || supply.invoiceKind === "bill_of_supply" ? (extras.customer?.gstin ?? null) : null)) : null;
  const name = b?.name.trim() || (gstin ? (extras.customer?.name ?? null) : null);
  const invoiceKind = kind === "sale" ? supply.invoiceKind : (bill.ret?.lines.some((l) => !l.tax.igst.isZero()) ? "business" : "consumer");
  return {
    title: gstDocumentTitle(kind, invoiceKind),
    invoiceKind,
    sellerGstin: till.company.gstin,
    buyer: kind === "sale" && (gstin || name || b?.address.trim()) ? { name, gstin, address: b?.address.trim() || null, state: stateOf(gstin ? gstin.slice(0, 2) : b?.stateCode) } : null,
    placeOfSupply: kind === "sale" ? stateOf(supply.placeOfSupply) : null,
    interState: kind === "sale" ? supply.interState : !!bill.ret?.igst && !bill.ret.igst.isZero(),
    // Audit 4 (28 October 2026): rule 46(p) reverse charge and the rule 46 third-proviso SEZ endorsement follow the buyer's situation.
    reverseCharge: kind === "sale" && supply.situation === "reverse_charge",
    buyerSituation: kind === "sale" ? supply.situation : null,
    endorsement: kind === "sale" && supply.situation === "sez" && supply.invoiceKind !== "bill_of_supply" ? (supply.noTax ? SEZ_UNDER_LUT : SEZ_WITH_IGST) : null,
    original: kind === "return" && extras.originalNumber ? { number: extras.originalNumber, date: "" } : null,
    declaration: kind === "sale" && supply.invoiceKind === "bill_of_supply" ? BILL_OF_SUPPLY_DECLARATION : null,
    creditNoteLate: false,
  };
}

export const HELPER_URL = "http://127.0.0.1:47120";
export const HELPER_TOKEN_KEY = "retail-erp:till-helper-token";
export const HELPER_TOKEN_HEADER = "x-helper-token";

/** A receipt with the shop's header, ready for the printer. */
export interface PrintableReceipt extends PrintReceiptData {
  store: { name: string; address: string; phone: string | null; code: string };
  company: { legalName: string; gstin: string | null };
  cashier?: string | null;
  customer?: string | null;
}

export function withHeader(r: Receipt | PrintReceiptData, till: SnapTill, extra: { cashier?: string | null; customer?: string | null } = {}): PrintableReceipt {
  return {
    ...r,
    store: { name: till.store.name, address: till.store.address, phone: till.store.phone, code: till.store.code },
    company: { legalName: till.company.legalName, gstin: till.company.gstin },
    cashier: extra.cashier ?? null,
    customer: extra.customer ?? null,
  };
}

function partReceipt(part: ComputedPart, kind: "sale" | "return", number: string, o: { soldAt: string; till: SnapTill; payments: Receipt["payments"]; change: Decimal; extras: LocalReceiptExtras; gst: PrintGst }): PrintReceiptData {
  const staff = new Map((o.extras.staff ?? []).map((x) => [x.id, x]));
  const d = kind === "sale" ? o.extras.delivery : null;
  const byRate = new Map<string, { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();
  for (const l of part.lines) {
    const k = l.gstRate.toString();
    const r = byRate.get(k) ?? { taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
    byRate.set(k, { taxable: r.taxable.add(l.tax.taxable), cgst: r.cgst.add(l.tax.cgst), sgst: r.sgst.add(l.tax.sgst), igst: r.igst.add(l.tax.igst) });
  }
  return {
    billId: null,
    number,
    kind,
    duplicate: false,
    // Owner decision of 22 Oct 2026: GST applies as soon as it is saved, so a bill made now is never provisional.
    provisional: false,
    soldAt: o.soldAt,
    till: o.till.code,
    footer: o.till.receiptFooter,
    gst: o.gst,
    lines: part.lines.map((l) => ({
      name: l.item.name,
      code: l.item.code,
      hsn: hsnForPrint(l.item.hsnCode, o.till.gst?.hsnDigits ?? 4) || null,
      quantity: l.quantity.toString(),
      // Audit 4 (28 October 2026): rule 46(i), the unit after the quantity.
      unit: l.unitCode || null,
      price: l.price.toFixed(2),
      discount: l.discountAmount.toFixed(2),
      amount: l.amount.toFixed(2),
      free: l.isFree,
      serials: [],
      offer: l.offer?.name ?? null,
      salesStaff: l.salesStaffId ? (staff.get(l.salesStaffId)?.code ?? null) : null,
    })),
    offers: kind === "sale" ? offersUsed(part.lines).map((u) => ({ name: u.offer.name, saving: u.saving.toFixed(2) })) : [],
    salesStaff: kind === "sale" && o.extras.salesStaffId ? (staff.get(o.extras.salesStaffId)?.name ?? null) : null,
    delivery: d ? { name: d.name.trim() || null, address: d.address.trim(), phone: d.phone.trim() || null, deliverOn: d.deliverOn || null, chargeAmount: (o.extras.deliveryCharge ?? new Decimal(0)).toFixed(2) } : null,
    // Audit 4 (28 October 2026): the "GST table" setting only changes the layout (taxTable); a tax invoice or
    // credit note always carries its tax per rate (rule 46(k)-(m)). None on a bill of supply or a return note.
    taxTable: o.till.gst?.receiptTaxTable !== false,
    gstTable: o.gst.invoiceKind === "bill_of_supply" || isReturnNote(o.gst.title) ? [] : [...byRate.entries()].map(([rate, r]) => ({ rate, taxable: r.taxable.toFixed(2), cgst: r.cgst.toFixed(2), sgst: r.sgst.toFixed(2), igst: r.igst.toFixed(2) })),
    totals: { gross: part.gross.toFixed(2), discount: part.discount.toFixed(2), taxable: part.taxable.toFixed(2), rounding: part.rounding.toFixed(2), total: part.total.toFixed(2) },
    payments: o.payments,
    change: o.change.toFixed(2),
    loyalty: kind === "sale" && o.extras.loyaltyNote ? { scheme: o.extras.loyaltyNote.scheme, earned: 0, spent: 0, restored: 0, reversed: 0, balance: null, note: o.extras.loyaltyNote.note } : null,
    giftCards: [],
  };
}

/** Receipts for a bill made on the till (offline), shaped like the server's. */
export function localReceipts(
  bill: ComputedBill,
  numbers: { sale?: string; ret?: string },
  o: { soldAt: string; till: SnapTill; payments: { paymentMethodId: string; amount: string; reference?: string | null; name?: string }[]; change: Decimal; extras?: LocalReceiptExtras },
): PrintReceiptData[] {
  const extras = o.extras ?? {};
  const names = new Map<string, SnapPaymentMethod>(o.till.paymentMethods.map((m) => [m.id, m]));
  const pays = o.payments.filter((p) => !new Decimal(p.amount).isZero()).map((p) => ({ method: names.get(p.paymentMethodId)?.name ?? p.name ?? "Payment", amount: new Decimal(p.amount).toFixed(2), reference: p.reference ?? null }));
  // The bill that carries the payments, as on the server: the sale unless money goes back.
  const holder = bill.net.gte(0) ? (bill.sale ? "sale" : "return") : bill.ret ? "return" : "sale";
  const out: PrintReceiptData[] = [];
  if (bill.ret && numbers.ret) out.push(partReceipt(bill.ret, "return", numbers.ret, { soldAt: o.soldAt, till: o.till, payments: holder === "return" ? pays : [], change: holder === "return" ? o.change : new Decimal(0), extras, gst: localGst(bill, "return", o.till, extras) }));
  if (bill.sale && numbers.sale) out.push(partReceipt(bill.sale, "sale", numbers.sale, { soldAt: o.soldAt, till: o.till, payments: holder === "sale" ? pays : [], change: holder === "sale" ? o.change : new Decimal(0), extras, gst: localGst(bill, "sale", o.till, extras) }));
  return out;
}

// ---- The Till Helper ----

export function helperToken(): string | null {
  try {
    return localStorage.getItem(HELPER_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function helperFetch(path: string, method: "GET" | "POST", body?: unknown, timeoutMs = 3000): Promise<Response | null> {
  const token = helperToken();
  if (!token) return null;
  const ctrl = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    return await fetch(`${HELPER_URL}${path}`, {
      method,
      headers: { [HELPER_TOKEN_HEADER]: token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl?.signal,
      cache: "no-store",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Swaps the 6-digit code the helper shows for its token (POST /pair), kept in this browser. */
export async function pairHelper(code: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${HELPER_URL}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }), cache: "no-store" });
  } catch {
    throw new Error("The Till Helper is not running on this computer");
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !body.token) throw new Error(body.message ?? "Pairing failed");
  localStorage.setItem(HELPER_TOKEN_KEY, body.token);
}

export async function helperStatus(): Promise<{ ok: boolean; printer: unknown; drawer: unknown } | null> {
  const res = await helperFetch("/status", "GET");
  if (!res?.ok) return null;
  try {
    return (await res.json()) as { ok: boolean; printer: unknown; drawer: unknown };
  } catch {
    return null;
  }
}

/** Prints through the helper; false when it is not there or refused, so the caller uses the browser. */
export async function printWithHelper(receipts: PrintableReceipt[]): Promise<boolean> {
  for (const receipt of receipts) {
    const res = await helperFetch("/print", "POST", { receipt }, 8000);
    if (!res?.ok) return false;
  }
  return true;
}

export async function openDrawer(): Promise<boolean> {
  const res = await helperFetch("/drawer/open", "POST", {});
  return !!res?.ok;
}
