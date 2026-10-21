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
import type { Receipt, ReceiptGst, SnapPaymentMethod, SnapSalesStaff, SnapTill } from "./types";

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
}

const stateOf = (code: string | null | undefined) => (code ? { code, name: INDIAN_STATES[code] ?? code } : null);

/** Plan 08: the GST part of the till's own receipt, shaped like the server's. */
function localGst(bill: ComputedBill, kind: "sale" | "return", till: SnapTill, extras: LocalReceiptExtras): ReceiptGst {
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
    reverseCharge: false,
    original: kind === "return" && extras.originalNumber ? { number: extras.originalNumber, date: "" } : null,
    declaration: kind === "sale" && supply.invoiceKind === "bill_of_supply" ? BILL_OF_SUPPLY_DECLARATION : null,
    creditNoteLate: false,
  };
}

export const HELPER_URL = "http://127.0.0.1:47120";
export const HELPER_TOKEN_KEY = "retail-erp:till-helper-token";
export const HELPER_TOKEN_HEADER = "x-helper-token";

/** A receipt with the shop's header, ready for the printer. */
export interface PrintableReceipt extends Receipt {
  store: { name: string; address: string; phone: string | null; code: string };
  company: { legalName: string; gstin: string | null };
  cashier?: string | null;
  customer?: string | null;
}

export function withHeader(r: Receipt, till: SnapTill, extra: { cashier?: string | null; customer?: string | null } = {}): PrintableReceipt {
  return {
    ...r,
    store: { name: till.store.name, address: till.store.address, phone: till.store.phone, code: till.store.code },
    company: { legalName: till.company.legalName, gstin: till.company.gstin },
    cashier: extra.cashier ?? null,
    customer: extra.customer ?? null,
  };
}

function partReceipt(part: ComputedPart, kind: "sale" | "return", number: string, o: { soldAt: string; till: SnapTill; provisional: boolean; payments: Receipt["payments"]; change: Decimal; extras: LocalReceiptExtras; gst: ReceiptGst }): Receipt {
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
    provisional: o.provisional,
    soldAt: o.soldAt,
    till: o.till.code,
    footer: o.till.receiptFooter,
    gst: o.gst,
    lines: part.lines.map((l) => ({
      name: l.item.name,
      code: l.item.code,
      hsn: hsnForPrint(l.item.hsnCode, o.till.gst?.hsnDigits ?? 4) || null,
      quantity: l.quantity.toString(),
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
    gstTable: o.gst.invoiceKind === "bill_of_supply" || o.till.gst?.receiptTaxTable === false ? [] : [...byRate.entries()].map(([rate, r]) => ({ rate, taxable: r.taxable.toFixed(2), cgst: r.cgst.toFixed(2), sgst: r.sgst.toFixed(2), igst: r.igst.toFixed(2) })),
    totals: { gross: part.gross.toFixed(2), discount: part.discount.toFixed(2), taxable: part.taxable.toFixed(2), rounding: part.rounding.toFixed(2), total: part.total.toFixed(2) },
    payments: o.payments,
    change: o.change.toFixed(2),
  };
}

/** Receipts for a bill made on the till (offline), shaped like the server's. */
export function localReceipts(
  bill: ComputedBill,
  numbers: { sale?: string; ret?: string },
  o: { soldAt: string; till: SnapTill; payments: { paymentMethodId: string; amount: string; reference?: string | null }[]; change: Decimal; extras?: LocalReceiptExtras },
): Receipt[] {
  const extras = o.extras ?? {};
  const names = new Map<string, SnapPaymentMethod>(o.till.paymentMethods.map((m) => [m.id, m]));
  const pays = o.payments.filter((p) => !new Decimal(p.amount).isZero()).map((p) => ({ method: names.get(p.paymentMethodId)?.name ?? "Payment", amount: new Decimal(p.amount).toFixed(2), reference: p.reference ?? null }));
  // The bill that carries the payments, as on the server: the sale unless money goes back.
  const holder = bill.net.gte(0) ? (bill.sale ? "sale" : "return") : bill.ret ? "return" : "sale";
  const out: Receipt[] = [];
  if (bill.ret && numbers.ret) out.push(partReceipt(bill.ret, "return", numbers.ret, { soldAt: o.soldAt, till: o.till, provisional: bill.provisional, payments: holder === "return" ? pays : [], change: holder === "return" ? o.change : new Decimal(0), extras, gst: localGst(bill, "return", o.till, extras) }));
  if (bill.sale && numbers.sale) out.push(partReceipt(bill.sale, "sale", numbers.sale, { soldAt: o.soldAt, till: o.till, provisional: bill.provisional, payments: holder === "sale" ? pays : [], change: holder === "sale" ? o.change : new Decimal(0), extras, gst: localGst(bill, "sale", o.till, extras) }));
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
