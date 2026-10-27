// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 08 on the till (online and offline), worked out the same way as the
// server: price-band rates (8.3), business tax invoices with IGST (8.2), a
// delivery to another state (G1), composition bills of supply (8.6), buyer
// details from ₹50,000 (G5), credit notes keeping the original bill's tax (8.5)
// and no provisional bills: GST applies as soon as it is saved (8.11, owner
// decision of 22 Oct 2026).
import { describe, expect, it } from "vitest";
import { gstinCheckCharacter } from "shared";
import { CASH, PREFIX, sampleSnapshot, TILL_ID } from "./fixtures";
import { buildTransaction, buyerProblem, type DraftBill, type DraftLine, emptyDraft, priceBill } from "./pricing";
import { localReceipts } from "./receipt";
import type { SnapItem, StoredSnapshot } from "./types";

const DATE = "2026-10-18";
const PCS = "d0000000-0000-4000-8000-000000000001";
const LIST = "f0000000-0000-4000-8000-000000000002";
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHIRT_1050 = id(1);
const SHIRT_2000 = id(2);
const SHIRT_3000 = id(3);
const LAPTOP = id(4);
const KA_GSTIN = `29AABCK1234A1Z${gstinCheckCharacter("29AABCK1234A1Z")}`;

function item(itemId: string, name: string, hsn: string): SnapItem {
  return { ...sampleSnapshot().items[0], id: itemId, code: `ITM-${itemId.slice(-4)}`, name, hsnCode: hsn, mrp: null, maxDiscountPercent: "30", barcodes: [] };
}
const price = (itemId: string, p: string) => ({ id: `price-${itemId}`, priceListId: LIST, itemId, unitId: PCS, price: p, startDate: "2024-04-01", endDate: null, customerId: null, batchId: null, packSize: null });

function snapshot(gst: Partial<NonNullable<StoredSnapshot["till"]["gst"]>> = {}): StoredSnapshot {
  const s = sampleSnapshot();
  return {
    ...s,
    till: { ...s.till, cashierDiscountPercent: "25", gst: { scheme: "regular", hsnDigits: 4, receiptTaxTable: true, sellerState: "33", ...gst } },
    items: [item(SHIRT_1050, "Cotton shirt", "62052000"), item(SHIRT_2000, "Linen shirt", "62052000"), item(SHIRT_3000, "Silk shirt", "62052000"), item(LAPTOP, "Laptop", "84713010")],
    prices: [price(SHIRT_1050, "1050"), price(SHIRT_2000, "2000"), price(SHIRT_3000, "3000"), price(LAPTOP, "70800")],
    gstRates: [
      { hsnCode: "6205", rate: "12", effectiveFrom: "2024-04-01" },
      { hsnCode: "6205", rate: "5", priceFrom: null, priceUpTo: "2500", effectiveFrom: "2025-09-22" },
      { hsnCode: "6205", rate: "18", priceFrom: "2500", priceUpTo: null, effectiveFrom: "2025-09-22" },
      { hsnCode: "8471", rate: "18", effectiveFrom: "2025-04-01" },
    ],
  };
}

let k = 0;
const line = (itemId: string, over: Partial<DraftLine> = {}): DraftLine => ({ key: `k${++k}`, itemId, unitId: PCS, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0", ...over });
const draft = (lines: DraftLine[], over: Partial<DraftBill> = {}): DraftBill => ({ ...emptyDraft("d1", new Date("2026-10-18T05:00:00.000Z")), lines, ...over });
const tax = (b: ReturnType<typeof priceBill>) => b.sale!.lines.map((l) => [l.gstRate.toString(), l.tax.taxable.toFixed(2), l.tax.cgst.toFixed(2), l.tax.sgst.toFixed(2), l.tax.igst.toFixed(2)]);
const options = (offline: boolean) => ({ clientId: "00000000-0000-4000-8000-000000000099", tillId: TILL_ID, shiftClientId: "00000000-0000-4000-8000-000000000098", soldAt: "2026-10-18T05:00:00.000Z", offline, numbers: { sale: `${PREFIX}000042` } });

describe("GST at the till (plan 08)", () => {
  it("8.1 a consumer bill in the store's state: ₹1,050 is ₹1,000.00 + CGST ₹25.00 + SGST ₹25.00", () => {
    const bill = priceBill(draft([line(SHIRT_1050)]), { snapshot: snapshot(), date: DATE });
    expect(bill.problems).toEqual([]);
    expect(bill.supply).toMatchObject({ invoiceKind: "consumer", placeOfSupply: "33", interState: false });
    expect(tax(bill)).toEqual([["5", "1000.00", "25.00", "25.00", "0.00"]]);
  });

  it("8.3 ₹2,000 at 5% and ₹3,000 at 18% on one bill; a 20% discount brings the ₹3,000 shirt into the 5% band", () => {
    const bill = priceBill(draft([line(SHIRT_2000), line(SHIRT_3000)]), { snapshot: snapshot(), date: DATE });
    expect(tax(bill)).toEqual([
      ["5", "1904.76", "47.62", "47.62", "0.00"],
      ["18", "2542.37", "228.82", "228.81", "0.00"],
    ]);
    const discounted = priceBill(draft([line(SHIRT_3000, { discountPercent: "20" })]), { snapshot: snapshot(), date: DATE });
    expect(discounted.sale!.lines[0].gstRate.toString()).toBe("5");
    // Offline the till sends the rate it charged; the server checks it.
    const tx = buildTransaction({ ...draft([line(SHIRT_3000, { discountPercent: "20" })]), payments: [{ methodId: CASH, amount: "2400", reference: "" }] }, discounted, snapshot().till.paymentMethods, options(true));
    expect(tx.sale!.lines[0].charged).toMatchObject({ gstRate: "5", lineTotal: "2400.00" });
  });

  it("8.4 an old bill date keeps the old rate", () => {
    const bill = priceBill(draft([line(SHIRT_1050)]), { snapshot: snapshot(), date: "2025-09-21" });
    expect(tax(bill)).toEqual([["12", "937.50", "56.25", "56.25", "0.00"]]);
  });

  it("8.2 a Karnataka GSTIN makes a business tax invoice with IGST ₹50.00; the buyer goes to the server", () => {
    const buyer = { gstin: KA_GSTIN, name: "Kaveri Traders", address: "12 MG Road, Bengaluru", stateCode: "" };
    const d = draft([line(SHIRT_1050)], { buyer });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.problems).toEqual([]);
    expect(bill.supply).toMatchObject({ invoiceKind: "business", placeOfSupply: "29", interState: true });
    expect(tax(bill)).toEqual([["5", "1000.00", "0.00", "0.00", "50.00"]]);
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1050", reference: "" }] }, bill, snapshot().till.paymentMethods, options(true));
    expect(tx.buyer).toEqual({ gstin: KA_GSTIN, name: "Kaveri Traders", address: "12 MG Road, Bengaluru" });
    const [receipt] = localReceipts(bill, { sale: `${PREFIX}000042` }, { soldAt: "2026-10-18T05:00:00.000Z", till: snapshot().till, payments: tx.payments, change: bill.net.sub(bill.net), extras: { buyer } });
    expect(receipt.gst).toMatchObject({ title: "Tax invoice", invoiceKind: "business", sellerGstin: "33AAAAA0000A1Z9", buyer: { gstin: KA_GSTIN, name: "Kaveri Traders", state: { code: "29", name: "Karnataka" } }, placeOfSupply: { code: "29", name: "Karnataka" } });
    expect(receipt.lines[0].hsn).toBe("6205");
  });

  it("8.2 a GSTIN with a typing mistake, or without the buyer's name and address, is refused in plain words", () => {
    const typo = KA_GSTIN.slice(0, 14) + (KA_GSTIN[14] === "A" ? "B" : "A");
    expect(buyerProblem({ gstin: typo, name: "x", address: "y", stateCode: "" })).toMatch(/typing mistake/);
    expect(buyerProblem({ gstin: KA_GSTIN, name: "", address: "", stateCode: "" })).toMatch(/name and address/);
    const bill = priceBill(draft([line(SHIRT_1050)], { buyer: { gstin: typo, name: "x", address: "y", stateCode: "" } }), { snapshot: snapshot(), date: DATE });
    expect(bill.problems.join(" ")).toMatch(/typing mistake/);
  });

  it("G1 a home delivery to Kerala is IGST", () => {
    const bill = priceBill(draft([line(SHIRT_1050)], { delivery: { name: "", address: "5 Beach Road, Kochi", phone: "", deliverOn: "", remarks: "", stateCode: "32" } }), { snapshot: snapshot(), date: DATE });
    expect(bill.supply).toMatchObject({ invoiceKind: "consumer", placeOfSupply: "32", interState: true });
    expect(tax(bill)[0][4]).toBe("50.00");
  });

  it("G5 a consumer bill of ₹50,000 or more needs the buyer's name, address and state", () => {
    const bare = priceBill(draft([line(LAPTOP)]), { snapshot: snapshot(), date: DATE });
    expect(bare.problems.join(" ")).toMatch(/₹50,000 or more/);
    const named = priceBill(draft([line(LAPTOP)], { buyer: { gstin: "", name: "Anil Kumar", address: "4 Lake View, Chennai", stateCode: "33" } }), { snapshot: snapshot(), date: DATE });
    expect(named.problems).toEqual([]);
    expect(named.sale!.taxable.toFixed(2)).toBe("60000.00");
  });

  it("8.6 composition: a bill of supply with no GST and the declaration on the receipt", () => {
    const snap = snapshot({ scheme: "composition" });
    const bill = priceBill(draft([line(SHIRT_1050)]), { snapshot: snap, date: DATE });
    expect(bill.supply.invoiceKind).toBe("bill_of_supply");
    expect(tax(bill)).toEqual([["0", "1050.00", "0.00", "0.00", "0.00"]]);
    const [receipt] = localReceipts(bill, { sale: `${PREFIX}000042` }, { soldAt: "2026-10-18T05:00:00.000Z", till: snap.till, payments: [], change: bill.net.sub(bill.net) });
    expect(receipt.gst).toMatchObject({ title: "Bill of supply", declaration: "Composition taxable person, not eligible to collect tax on supplies" });
    expect(receipt.gstTable).toEqual([]);
  });

  it("8.5 a credit note keeps the original bill's IGST", () => {
    const d = draft([], {
      ret: {
        originalBillId: id(90),
        originalNumber: `${PREFIX}000001`,
        customerId: null,
        reason: null,
        supply: { interState: true, noTax: false },
        lines: [{ key: "r1", itemId: SHIRT_1050, unitId: PCS, code: "ITM-0001", name: "Cotton shirt", quantity: "1", originalLineId: id(91), maxQuantity: "1", originalQuantity: "1", originalPrice: "1050", originalDiscount: "0", originalLineTotal: "1050", gstRate: "5", isFree: false }],
      },
    });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.ret!.lines.map((l) => [l.tax.taxable.toFixed(2), l.tax.igst.toFixed(2), l.tax.cgst.toFixed(2)])).toEqual([["-1000.00", "-50.00", "0.00"]]);
    const [receipt] = localReceipts(bill, { ret: `${PREFIX}000043` }, { soldAt: "2026-10-18T05:00:00.000Z", till: snapshot().till, payments: [], change: bill.net.sub(bill.net), extras: { originalNumber: `${PREFIX}000001` } });
    expect(receipt.gst).toMatchObject({ title: "Credit note", original: { number: `${PREFIX}000001` } });
  });

  it("8.11 a bill made with a newly added rate is real GST at once: its receipt is not provisional", () => {
    const s = snapshot();
    s.gstRates = [...s.gstRates, { hsnCode: "8471", rate: "28", effectiveFrom: DATE }];
    const bill = priceBill(draft([line(LAPTOP)]), { snapshot: s, date: DATE });
    expect(bill.sale!.lines[0].gstRate.toString()).toBe("28");
    const [receipt] = localReceipts(bill, { sale: `${PREFIX}000044` }, { soldAt: "2026-10-18T05:00:00.000Z", till: s.till, payments: [], change: bill.net.sub(bill.net) });
    expect(receipt.provisional).toBe(false);
  });
});
