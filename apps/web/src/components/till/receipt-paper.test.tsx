// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 4 (28 October 2026): the screen receipt prints what the CGST Rules ask
// of a till tax invoice: unit after the quantity (rule 46(i)), tax per rate even
// with the GST table off (rule 46(k)-(m)), reverse charge on every tax invoice
// (rule 46(p)), the SEZ endorsement (rule 46, third proviso), and a return note
// with no GST.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PrintableReceipt } from "@/lib/till/receipt";
import { ReceiptPaper } from "./receipt-paper";

afterEach(cleanup);

const gst = { title: "Tax invoice", invoiceKind: "consumer", sellerGstin: "33AAAAA0000A1Z9", buyer: null, placeOfSupply: { code: "33", name: "Tamil Nadu" }, interState: false, reverseCharge: false, original: null, declaration: null, creditNoteLate: false };

function receipt(over: Partial<PrintableReceipt> = {}): PrintableReceipt {
  return {
    billId: null,
    number: "MAIN-T1-000042",
    kind: "sale",
    duplicate: false,
    provisional: false,
    soldAt: "2026-10-18T05:00:00.000Z",
    till: "T1",
    footer: null,
    lines: [{ name: "Loose rice", code: "RICE", hsn: "1006", quantity: "2.5", unit: "KG", price: "420.00", discount: "0.00", amount: "1050.00", free: false, serials: [] }],
    gstTable: [{ rate: "5", taxable: "1000.00", cgst: "25.00", sgst: "25.00", igst: "0.00" }],
    totals: { gross: "1050.00", discount: "0.00", taxable: "1000.00", rounding: "0.00", total: "1050.00" },
    payments: [],
    change: "0.00",
    gst,
    store: { name: "Main", address: "1 Road", phone: null, code: "MAIN" },
    company: { legalName: "Rademics Retail", gstin: null },
    ...over,
  };
}
const text = () => document.body.textContent ?? "";

describe("audit 4: the till receipt on screen", () => {
  it("prints the unit after the quantity", () => {
    render(<ReceiptPaper receipt={receipt()} />);
    expect(screen.getByText("2.5 KG")).toBeTruthy();
  });

  it("keeps the tax when the GST table is switched off: one short line per rate", () => {
    render(<ReceiptPaper receipt={receipt({ taxTable: false })} />);
    expect(screen.getByTestId("receipt-gst-short").textContent).toBe("GST 5%: taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00");
    expect(document.querySelector(".till-receipt-gst")).toBeNull();
    cleanup();
    render(<ReceiptPaper receipt={receipt({ taxTable: false, gstTable: [{ rate: "5", taxable: "1000.00", cgst: "0.00", sgst: "0.00", igst: "50.00" }] })} />);
    expect(screen.getByTestId("receipt-gst-short").textContent).toBe("GST 5%: taxable ₹1,000.00, IGST ₹50.00");
  });

  it("prints the taxable value when the server sent no rows for a tax invoice", () => {
    render(<ReceiptPaper receipt={receipt({ gstTable: [] })} />);
    expect(text()).toMatch(/Taxable value₹1,000\.00/);
  });

  it("states reverse charge on every tax invoice, Yes for a reverse-charge buyer", () => {
    render(<ReceiptPaper receipt={receipt()} />);
    expect(text()).toMatch(/Tax payable on reverse charge: No/);
    cleanup();
    render(<ReceiptPaper receipt={receipt({ gst: { ...gst, buyerSituation: "reverse_charge" } })} />);
    expect(text()).toMatch(/Tax payable on reverse charge: Yes/);
  });

  it("endorses a supply to an SEZ", () => {
    render(<ReceiptPaper receipt={receipt({ gst: { ...gst, invoiceKind: "business", buyerSituation: "sez" }, gstTable: [{ rate: "5", taxable: "1000.00", cgst: "0.00", sgst: "0.00", igst: "50.00" }] })} />);
    expect(screen.getByTestId("receipt-sez").textContent).toMatch(/ON PAYMENT OF INTEGRATED TAX$/);
    cleanup();
    render(<ReceiptPaper receipt={receipt({ gst: { ...gst, invoiceKind: "business", buyerSituation: "sez" }, gstTable: [{ rate: "5", taxable: "1050.00", cgst: "0.00", sgst: "0.00", igst: "0.00" }] })} />);
    expect(screen.getByTestId("receipt-sez").textContent).toMatch(/UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX$/);
  });

  it("prints a return note as such, with no GST", () => {
    render(<ReceiptPaper receipt={receipt({ kind: "return", gst: { ...gst, title: "Return note" } })} />);
    expect(text()).toMatch(/RETURN NOTE/);
    expect(text()).toMatch(/Not a credit note: no GST is reduced/);
    expect(text()).not.toMatch(/CGST|reverse charge|Taxable value/);
  });

  it("prints whatever title it is given, such as an invoice-cum-bill of supply", () => {
    render(<ReceiptPaper receipt={receipt({ gst: { ...gst, title: "Invoice-cum-bill of supply" } })} />);
    expect(text()).toMatch(/INVOICE-CUM-BILL OF SUPPLY/);
  });

  it("names the original bill and the buyer on a credit note", () => {
    render(<ReceiptPaper receipt={receipt({ kind: "return", gst: { ...gst, title: "Credit note", original: { number: "MAIN-T1-000001", date: "2026-10-01" }, buyer: { name: "Anil Kumar", gstin: null, address: "4 Lake View, Chennai", state: { code: "33", name: "Tamil Nadu" } } } })} />);
    expect(text()).toMatch(/Against bill MAIN-T1-000001 dated 01 Oct 2026/);
    expect(text()).toMatch(/Buyer: Anil Kumar/);
    expect(text()).toMatch(/4 Lake View, Chennai/);
    expect(text()).toMatch(/State: Tamil Nadu \(33\)/);
  });
});
