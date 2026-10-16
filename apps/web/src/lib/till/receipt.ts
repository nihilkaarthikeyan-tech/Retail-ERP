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
import { Decimal } from "shared";
import type { ComputedBill, ComputedPart } from "./pricing";
import type { Receipt, SnapPaymentMethod, SnapTill } from "./types";

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

function partReceipt(part: ComputedPart, kind: "sale" | "return", number: string, o: { soldAt: string; till: SnapTill; provisional: boolean; payments: Receipt["payments"]; change: Decimal }): Receipt {
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
    lines: part.lines.map((l) => ({ name: l.item.name, code: l.item.code, hsn: l.item.hsnCode, quantity: l.quantity.toString(), price: l.price.toFixed(2), discount: l.discountAmount.toFixed(2), amount: l.amount.toFixed(2), free: l.isFree, serials: [] })),
    gstTable: [...byRate.entries()].map(([rate, r]) => ({ rate, taxable: r.taxable.toFixed(2), cgst: r.cgst.toFixed(2), sgst: r.sgst.toFixed(2), igst: r.igst.toFixed(2) })),
    totals: { gross: part.gross.toFixed(2), discount: part.discount.toFixed(2), taxable: part.taxable.toFixed(2), rounding: part.rounding.toFixed(2), total: part.total.toFixed(2) },
    payments: o.payments,
    change: o.change.toFixed(2),
  };
}

/** Receipts for a bill made on the till (offline), shaped like the server's. */
export function localReceipts(
  bill: ComputedBill,
  numbers: { sale?: string; ret?: string },
  o: { soldAt: string; till: SnapTill; payments: { paymentMethodId: string; amount: string; reference?: string | null }[]; change: Decimal },
): Receipt[] {
  const names = new Map<string, SnapPaymentMethod>(o.till.paymentMethods.map((m) => [m.id, m]));
  const pays = o.payments.filter((p) => !new Decimal(p.amount).isZero()).map((p) => ({ method: names.get(p.paymentMethodId)?.name ?? "Payment", amount: new Decimal(p.amount).toFixed(2), reference: p.reference ?? null }));
  // The bill that carries the payments, as on the server: the sale unless money goes back.
  const holder = bill.net.gte(0) ? (bill.sale ? "sale" : "return") : bill.ret ? "return" : "sale";
  const out: Receipt[] = [];
  if (bill.ret && numbers.ret) out.push(partReceipt(bill.ret, "return", numbers.ret, { soldAt: o.soldAt, till: o.till, provisional: bill.provisional, payments: holder === "return" ? pays : [], change: holder === "return" ? o.change : new Decimal(0) }));
  if (bill.sale && numbers.sale) out.push(partReceipt(bill.sale, "sale", numbers.sale, { soldAt: o.soldAt, till: o.till, provisional: bill.provisional, payments: holder === "sale" ? pays : [], change: holder === "sale" ? o.change : new Decimal(0) }));
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
