// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import type { GoodsReceiptDto, SupplierBillDto } from "@/lib/purchasing";
import { BillDebitNoteDialog } from "./bills-dialogs";
import { BillEditor } from "./bills-editor";
import { type BillLineDraft, billLineProblem, billLineToInput, linesFromReceipt, previewBill, previewLine } from "./bills-lines";
import { BillView } from "./bills-view";
import { PurchaseReports, REGISTER_COLUMNS, type RegisterRow, reportCsv } from "./reports-tabs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const BILL_ID = "b1111111-1111-4111-8111-111111111111";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const PCS = "22222222-2222-4222-8222-222222222222";
const BOX = "33333333-3333-4333-8333-333333333333";
const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };

const user = (permissions: string[], isOwnerAdmin = false) => ({
  id: "u1",
  firstName: "Asha",
  lastName: null,
  email: "asha@example.com",
  isOwnerAdmin,
  permissions,
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
});

function bill(over: Partial<SupplierBillDto> = {}): SupplierBillDto {
  return {
    id: BILL_ID,
    number: "PB-0001",
    kind: "against_receipt",
    status: "draft",
    supplier: { id: "s1", code: "SUP-001", name: "Lakshmi Traders" },
    supplierBillNo: "LT/889",
    supplierBillDate: "2026-10-14",
    postingDate: "2026-10-15",
    storeId: MAIN.id,
    paymentTermsId: null,
    dueDate: "2026-11-13",
    overdue: false,
    held: false,
    holdReason: null,
    holdUntil: null,
    taxableAmount: "1000.00",
    taxAmount: "50.00",
    roundingAdjustment: "0.00",
    total: "1050.00",
    priceDifference: "20.00",
    returnOfId: null,
    receiptId: null,
    remarks: null,
    cancelReason: null,
    createdAt: "2026-10-15T05:00:00.000Z",
    finalisedAt: null,
    lines: [
      {
        id: "l1111111-1111-4111-8111-111111111111",
        lineNo: 1,
        item: { id: ITEM_ID, code: "ITM-000001", name: "Basmati Rice 1 kg", isStockItem: true },
        unitId: PCS,
        factor: "1",
        quantity: "10.000",
        freeQuantity: "0",
        basicQuantity: "10.000",
        returnedQuantity: "4.000",
        receiptLineId: "r1",
        receipt: { id: "c1111111-1111-4111-8111-111111111111", number: "GR-0001" },
        orderLineId: null,
        order: null,
        accountRole: "goods_received_not_billed",
        rate: "100.00",
        discountPercent: "0.00",
        taxableAmount: "1000.00",
        gstRate: "5",
        cgst: "25.00",
        sgst: "25.00",
        igst: "0.00",
        lineTotal: "1050.00",
        priceDifference: "20.00",
      },
    ],
    ...over,
  };
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match =
      Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ??
      Object.entries(routes).find(([key]) => !key.includes(" ") && (url.pathname === key || url.pathname.startsWith(`${key}/`)));
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function writes(fn: ReturnType<typeof vi.fn>): { method: string; path: string; body: unknown }[] {
  return fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") !== "GET")
    .map((c) => ({ method: c.init!.method!, path: c.url.pathname, body: c.init?.body ? JSON.parse(String(c.init.body)) : undefined }));
}

const commonRoutes = (permissions: string[], isOwnerAdmin = false): Record<string, Route> => ({
  "/auth/me": () => ({ status: 200, body: user(permissions, isOwnerAdmin) }),
  "/items": () => ({ status: 404, body: { statusCode: 404, message: "not needed" } }),
  "/stock/locations": () => ({ status: 200, body: [{ id: "f1", code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: MAIN, active: true }] }),
  "/payment-terms": () => ({ status: 200, body: [] }),
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("finalising a bill whose prices differ from the receipt", () => {
  it("shows the API's PRICE_DIFFERENCE message and re-posts with confirmPriceDifference", async () => {
    const message = "PRICE_DIFFERENCE: the bill’s prices differ from the goods receipts (ITM-000001 +20.00). Check with the supplier, then confirm to record the difference.";
    const finalised = bill({ status: "unpaid", finalisedAt: "2026-10-15T06:00:00.000Z", warnings: ["ITM-000001: billed ₹1020.00 against ₹1000.00 ordered on PO-0001; accepted above the allowance"] });
    const fetchMock = mockApi({
      ...commonRoutes(["purchase.view", "purchase.bill", "buying_prices.view"]),
      [`POST /purchase/bills/${BILL_ID}/finalise`]: (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { confirmPriceDifference?: boolean };
        return body.confirmPriceDifference ? { status: 200, body: finalised } : { status: 400, body: { statusCode: 400, message, error: "Bad Request" } };
      },
    });
    const onChanged = vi.fn();
    render(
      <AuthProvider>
        <BillView bill={bill()} onChanged={onChanged} />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Finalise" }));
    expect(await screen.findByText(/differ from the goods receipts \(ITM-000001 \+20\.00\)/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Record the difference" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(finalised));
    expect(writes(fetchMock).map((w) => w.body)).toEqual([{}, { confirmPriceDifference: true }]);
    // Over-billing accepted with a warning is shown.
    expect(await screen.findByText(/accepted above the allowance/)).toBeTruthy();
  });

  it("shows any other refusal as it is, without the confirm box", async () => {
    const message = "The bill’s prices differ from the goods receipts (ITM-000001 +20.00); they must match";
    mockApi({
      ...commonRoutes(["purchase.view", "purchase.bill", "buying_prices.view"]),
      [`POST /purchase/bills/${BILL_ID}/finalise`]: () => ({ status: 400, body: { statusCode: 400, message } }),
    });
    render(
      <AuthProvider>
        <BillView bill={bill()} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Finalise" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === message)).toBe(true));
    expect(screen.queryByRole("button", { name: "Record the difference" })).toBeNull();
  });

  it("shows the account role in plain words and the API's amounts", async () => {
    mockApi(commonRoutes(["purchase.view", "buying_prices.view"]));
    render(
      <AuthProvider>
        <BillView bill={bill()} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText("Goods received, not billed")).toBeTruthy();
    expect(screen.getAllByText("₹1,050.00").length).toBeGreaterThan(0);
    // No purchase.bill right: no Finalise button.
    expect(screen.queryByRole("button", { name: "Finalise" })).toBeNull();
  });
});

describe("debit note", () => {
  it("posts only the lines with a quantity, and refuses more than is left", async () => {
    const note = bill({ id: "d1", kind: "debit_note", status: "unpaid", number: "DN-0001", returnOfId: BILL_ID });
    const fetchMock = mockApi({ [`POST /purchase/bills/${BILL_ID}/debit-note`]: () => ({ status: 201, body: note }) });
    const onDone = vi.fn();
    render(<BillDebitNoteDialog bill={bill({ status: "unpaid" })} open onClose={vi.fn()} onDone={onDone} />);
    const qty = screen.getByLabelText("Quantity going back for ITM-000001");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Damaged bags" } });

    fireEvent.change(qty, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Make debit note" }));
    expect(await screen.findByText("ITM-000001: only 6 left on the bill")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);

    fireEvent.change(qty, { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/credit note number/), { target: { value: "CN-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Make debit note" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(note));
    expect(writes(fetchMock)[0].body).toEqual({ reason: "Damaged bags", supplierNoteNo: "CN-12", lines: [{ originalLineId: bill().lines[0].id, quantity: "2" }] });
  });

  it("explains that goods leave stock for a bill that received them", () => {
    mockApi({});
    render(<BillDebitNoteDialog bill={bill({ status: "unpaid", kind: "receives_goods" })} open onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/goods also leave stock, at the cost they came in at/)).toBeTruthy();
  });
});

describe("choosing the kind of bill", () => {
  it("asks for the store only on a bill that also receives the goods", async () => {
    mockApi(commonRoutes([], true));
    render(
      <AuthProvider>
        <BillEditor kind="receives_goods" bill={null} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByLabelText(/Store the goods arrive at/)).toBeTruthy();
    expect(screen.getByText(/saving the bill also brings them into stock/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Scan a barcode/)).toBeTruthy();
  });

  it("against receipts: no store, and the supplier comes first", async () => {
    mockApi(commonRoutes([], true));
    render(
      <AuthProvider>
        <BillEditor kind="against_receipt" bill={null} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Choose the supplier first/)).toBeTruthy();
    expect(screen.queryByLabelText(/Store the goods arrive at/)).toBeNull();
  });

  it("services: searches non-stock items and refuses to save without a bill number", async () => {
    const fetchMock = mockApi(commonRoutes([], true));
    render(
      <AuthProvider>
        <BillEditor kind="services" bill={null} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByLabelText(/Add a service or non-stock item/)).toBeTruthy();
    expect(screen.queryByLabelText(/Store the goods arrive at/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/Type the bill number printed on the supplier's bill/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

function draftLine(over: Partial<BillLineDraft> = {}): BillLineDraft {
  return {
    key: "k1",
    include: true,
    itemId: ITEM_ID,
    itemCode: "ITM-000001",
    itemName: "Rice",
    units: null,
    unitId: PCS,
    factor: "1",
    trackBatches: false,
    trackSerials: false,
    autoNumberBatches: true,
    receiptLineId: null,
    receipt: null,
    orderLineId: null,
    billable: null,
    quantity: "3",
    freeQuantity: "",
    rate: "33.33",
    discountPercent: "",
    gstRate: "18",
    cgst: "",
    sgst: "",
    igst: "",
    shelfLocationId: "",
    batchNumber: "",
    manufactureDate: "",
    expiryDate: "",
    serials: "",
    creditClaimable: true,
    ...over,
  };
}

describe("bill line preview and input", () => {
  it("suggests GST from the rate when none is typed, and rounds the total to the rupee", () => {
    const p = previewLine(draftLine())!;
    expect(p.taxable.toFixed(2)).toBe("99.99");
    expect(p.cgst.toFixed(2)).toBe("9.00");
    expect(p.sgst.toFixed(2)).toBe("9.00");
    expect(p.suggested).toBe(true);
    const t = previewBill([draftLine()]);
    expect(t.tax.toFixed(2)).toBe("18.00");
    expect(t.total.toFixed(2)).toBe("118.00");
    expect(t.roundingAdjustment.toFixed(2)).toBe("0.01");
  });

  it("uses the GST typed from the supplier's bill (blank parts are zero)", () => {
    const p = previewLine(draftLine({ igst: "18.01" }))!;
    expect(p.suggested).toBe(false);
    expect(p.gst.toFixed(2)).toBe("18.01");
    expect(p.cgst.toFixed(2)).toBe("0.00");
  });

  it("leaves unticked and unpriced lines out of the totals", () => {
    const t = previewBill([draftLine({ include: false }), draftLine({ key: "k2", rate: "" })]);
    expect(t.total.toFixed(2)).toBe("0.00");
    expect(t.unpriced).toBe(1);
  });

  it("defaults receipt lines to what is left, in the line's unit", () => {
    const receipt = {
      id: "c1",
      number: "GR-0001",
      lines: [
        { id: "rl1", item: { id: ITEM_ID, code: "ITM-000001", name: "Rice", trackBatches: false, trackSerials: false }, unitId: BOX, factor: "12", billableQuantity: "24.000", orderLineId: null, rate: "600.00", discountPercent: "0.00", gstRate: "5" },
        { id: "rl2", item: { id: ITEM_ID, code: "ITM-000002", name: "Dal", trackBatches: false, trackSerials: false }, unitId: PCS, factor: "1", billableQuantity: "0", orderLineId: null },
      ],
    } as unknown as GoodsReceiptDto;
    const lines = linesFromReceipt(receipt);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ receiptLineId: "rl1", quantity: "2", billable: "2", rate: "600", gstRate: "5", discountPercent: "" });
    expect(billLineProblem({ ...lines[0], quantity: "3" }, "against_receipt")).toMatch(/only 2 still to be billed on GR-0001/);
  });

  it("sends only what was typed, so the API fills the rest", () => {
    expect(billLineToInput(draftLine({ rate: "", gstRate: "", receiptLineId: "rl1" }), "against_receipt")).toEqual({ receiptLineId: "rl1", itemId: ITEM_ID, unitId: PCS, quantity: "3" });
    expect(billLineToInput(draftLine({ cgst: "9", sgst: "9", shelfLocationId: "f1" }), "receives_goods")).toEqual({
      itemId: ITEM_ID,
      unitId: PCS,
      quantity: "3",
      rate: "33.33",
      gstRate: "18",
      cgst: "9",
      sgst: "9",
      shelfLocationId: "f1",
    });
  });
});

describe("GST on bill lines (plan 08 G8)", () => {
  it("sends a line whose credit cannot be claimed", () => {
    expect(billLineToInput(draftLine({ creditClaimable: false }), "services")).toMatchObject({ creditClaimable: false });
    expect(billLineToInput(draftLine(), "services")).not.toHaveProperty("creditClaimable");
  });

  it("under reverse charge the supplier is owed the bill without GST, and the GST is still shown", () => {
    const t = previewBill([draftLine({ quantity: "1", rate: "10000" })], true);
    expect(t.tax.toFixed(2)).toBe("1800.00");
    expect(t.total.toFixed(2)).toBe("10000.00");
  });

  it("shows reverse charge, the place of supply and lines with no input credit on a bill", async () => {
    mockApi(commonRoutes(["purchase.view", "buying_prices.view"]));
    const b = bill({ status: "unpaid", reverseCharge: true, placeOfSupply: "33", total: "1000.00", taxAmount: "50.00" });
    b.lines = b.lines.map((l) => ({ ...l, creditClaimable: false }));
    render(
      <AuthProvider>
        <BillView bill={b} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText(/The shop pays this bill's GST to the government itself/)).toBeTruthy();
    expect(screen.getByText("Tamil Nadu (33)")).toBeTruthy();
    expect(screen.getByText("GST paid by the shop (reverse charge)")).toBeTruthy();
    expect(screen.getByText("No input credit: added to cost")).toBeTruthy();
  });
});

describe("purchase reports", () => {
  it("exports the register as CSV with the same columns as on screen", () => {
    const rows: RegisterRow[] = [
      {
        billId: BILL_ID,
        number: "PB-0001",
        kind: "against_receipt",
        supplier: { code: "SUP-001", name: 'Lakshmi "LT" Traders', gstin: "33AAAAA0000A1Z5" },
        supplierBillNo: "LT/889",
        supplierBillDate: "2026-10-14",
        postingDate: "2026-10-15",
        item: { code: "ITM-000001", name: "Rice", hsnCode: "1006" },
        quantity: "10.000",
        rate: "100.00",
        taxableAmount: "1000.00",
        gstRate: "5",
        cgst: "25.00",
        sgst: "25.00",
        igst: "0.00",
        lineTotal: "1050.00",
      },
    ];
    const csv = reportCsv(REGISTER_COLUMNS, rows).split("\r\n");
    expect(csv[0]).toBe(
      '"Our number","Kind","Posting date","Supplier","Supplier GSTIN","Supplier\'s bill no","Supplier\'s bill date","Item","HSN","Quantity","Price","Before GST","GST %","CGST","SGST","IGST","Line total"',
    );
    expect(csv[1]).toBe(
      '"PB-0001","Against goods receipts","2026-10-15","SUP-001 Lakshmi ""LT"" Traders","33AAAAA0000A1Z5","LT/889","2026-10-14","ITM-000001 Rice","1006","10","100.00","1000.00","5","25.00","25.00","0.00","1050.00"',
    );
  });

  it("explains instead of loading the register without the buying prices right", async () => {
    const fetchMock = mockApi({
      ...commonRoutes(["purchase.view"]),
      "/purchase/reports": () => ({ status: 200, body: [] }),
    });
    render(
      <AuthProvider>
        <PurchaseReports />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Purchase register" }));
    expect(await screen.findByText(/This report shows buying prices/)).toBeTruthy();
    const calls = fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname);
    expect(calls).not.toContain("/purchase/reports/register");
  });
});
