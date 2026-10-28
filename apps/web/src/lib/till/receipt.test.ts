// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 4 (28 October 2026): what the till's own receipt carries for the CGST
// Rules: the unit after the quantity (rule 46(i)), the tax per rate even with
// the GST table switched off (rule 46(k)-(m)), reverse charge on every tax
// invoice (rule 46(p)), the SEZ endorsement (rule 46, third proviso) and a
// return note with no GST.
import { describe, expect, it } from "vitest";
import { gstinCheckCharacter } from "shared";
import { PREFIX, sampleSnapshot } from "./fixtures";
import { type DraftBill, type DraftLine, emptyDraft, priceBill } from "./pricing";
import { localReceipts, quantityWithUnit, receiptTaxView, RETURN_NOTE_LINE, SEZ_UNDER_LUT, SEZ_WITH_IGST } from "./receipt";
import type { Receipt, StoredSnapshot } from "./types";

const DATE = "2026-10-18";
const PCS = "d0000000-0000-4000-8000-000000000001";
const SHIRT = "50000000-0000-4000-8000-000000000001";
const KA_GSTIN = `29AABCK1234A1Z${gstinCheckCharacter("29AABCK1234A1Z")}`;

function snapshot(receiptTaxTable = true): StoredSnapshot {
  const s = sampleSnapshot();
  return {
    ...s,
    till: { ...s.till, gst: { scheme: "regular", hsnDigits: 4, receiptTaxTable, sellerState: "33" } },
    items: [{ ...s.items[0], id: SHIRT, code: "ITM-0001", name: "Cotton shirt", hsnCode: "62052000", mrp: null, barcodes: [] }],
    prices: [{ id: "p1", priceListId: "f0000000-0000-4000-8000-000000000002", itemId: SHIRT, unitId: PCS, price: "1050", startDate: "2024-04-01", endDate: null, customerId: null, batchId: null, packSize: null }],
    gstRates: [{ hsnCode: "6205", rate: "5", effectiveFrom: "2025-09-22" }],
  };
}
const line = (): DraftLine => ({ key: "k1", itemId: SHIRT, unitId: PCS, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0" });
const draft = (over: Partial<DraftBill> = {}): DraftBill => ({ ...emptyDraft("d1", new Date("2026-10-18T05:00:00.000Z")), lines: [line()], ...over });
function receiptFor(snap: StoredSnapshot, d: DraftBill) {
  const bill = priceBill(d, { snapshot: snap, date: DATE });
  return localReceipts(bill, { sale: `${PREFIX}000042` }, { soldAt: "2026-10-18T05:00:00.000Z", till: snap.till, payments: [], change: bill.net.sub(bill.net), extras: { buyer: d.buyer ?? null } })[0];
}

describe("audit 4: the till's own receipt", () => {
  it("carries the unit of each line (rule 46(i))", () => {
    const r = receiptFor(snapshot(), draft());
    expect(r.lines[0].unit).toBe("PCS");
    expect(quantityWithUnit("2.5", "KG")).toBe("2.5 KG");
    expect(quantityWithUnit("1", null)).toBe("1");
  });

  it("keeps the tax per rate when the GST table is switched off, laid out as short lines", () => {
    const r = receiptFor(snapshot(false), draft());
    expect(r.taxTable).toBe(false);
    expect(r.gstTable).toEqual([{ rate: "5", taxable: "1000.00", cgst: "25.00", sgst: "25.00", igst: "0.00" }]);
    expect(receiptTaxView(r)).toMatchObject({ table: false, short: true, reverseCharge: "No" });
    expect(receiptTaxView(receiptFor(snapshot(true), draft()))).toMatchObject({ table: true, short: false });
  });

  it("says Yes to reverse charge and endorses an SEZ supply from the buyer's situation", () => {
    const buyer = { gstin: KA_GSTIN, name: "Kaveri Traders", address: "12 MG Road, Bengaluru", stateCode: "" };
    const customer = { id: "c1", name: "Kaveri Traders", mobile: null, gstin: KA_GSTIN, stateCode: "29", customerGroupId: "g1" };
    const rc = receiptFor(snapshot(), draft({ buyer: { ...buyer, gstin: "" }, customer: { ...customer, taxSituation: "reverse_charge" } }));
    expect(rc.gst).toMatchObject({ reverseCharge: true, buyerSituation: "reverse_charge" });
    expect(receiptTaxView(rc).reverseCharge).toBe("Yes");
    const sez = receiptFor(snapshot(), draft({ buyer: { ...buyer, gstin: "" }, customer: { ...customer, taxSituation: "sez" } }));
    expect(sez.gst?.endorsement).toBe(SEZ_WITH_IGST);
    expect(receiptTaxView(sez).endorsement).toBe(SEZ_WITH_IGST);
  });

  it("works the SEZ wording out from the rows when the server sends only the situation", () => {
    const base = { kind: "sale" as const, taxTable: true, gst: { title: "Tax invoice", invoiceKind: "business", sellerGstin: null, buyer: null, placeOfSupply: null, interState: true, reverseCharge: false, original: null, declaration: null, creditNoteLate: false, buyerSituation: "sez" } };
    expect(receiptTaxView({ ...base, gstTable: [{ rate: "5", taxable: "1000.00", cgst: "0.00", sgst: "0.00", igst: "50.00" }] }).endorsement).toBe(SEZ_WITH_IGST);
    expect(receiptTaxView({ ...base, gstTable: [{ rate: "5", taxable: "1050.00", cgst: "0.00", sgst: "0.00", igst: "0.00" }] }).endorsement).toBe(SEZ_UNDER_LUT);
  });

  it("a return note and a bill of supply show no tax; a return note is recognised by title or kind", () => {
    const rows: Receipt["gstTable"] = [{ rate: "5", taxable: "1000.00", cgst: "25.00", sgst: "25.00", igst: "0.00" }];
    const gst = { title: "Return note", invoiceKind: "consumer", sellerGstin: null, buyer: null, placeOfSupply: null, interState: false, reverseCharge: false, original: null, declaration: null, creditNoteLate: false };
    expect(receiptTaxView({ kind: "return", gstTable: rows, gst })).toMatchObject({ returnNote: true, rows: [], table: false, short: false, reverseCharge: null });
    expect(receiptTaxView({ kind: "return", gstTable: rows, gst: { ...gst, title: "Credit note", documentKind: "return_note" } }).returnNote).toBe(true);
    expect(receiptTaxView({ kind: "sale", gstTable: rows, gst: { ...gst, title: "Bill of supply", invoiceKind: "bill_of_supply" } })).toMatchObject({ rows: [], reverseCharge: null });
    expect(RETURN_NOTE_LINE).toBe("Not a credit note: no GST is reduced");
  });
});
