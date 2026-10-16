// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import type { GoodsReceiptDto, GoodsReceiptLineDto, PurchaseOrderDto } from "@/lib/purchasing";
import type { ItemDto, StockLocationDto } from "@/lib/types";
import { ChargesEditor } from "./charges-editor";
import { ReceiptEditor } from "./receipts-editor";
import { lineWithoutOrder, receiptLineProblem } from "./receipts-lines";
import { ReceiptView } from "./receipts-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const FLOOR = "c1111111-1111-4111-8111-111111111111";
const BACK = "c4444444-4444-4444-8444-444444444444";
const REJECTED = "c5555555-5555-4555-8555-555555555555";
const PCS = "22222222-2222-4222-8222-222222222222";
const SUPPLIER = { id: "55555555-5555-4555-8555-555555555555", code: "SUP-0001", name: "Sri Murugan Traders" };
const ORDER_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_LINE_ID = "77777777-7777-4777-8777-777777777777";
const RECEIPT_ID = "88888888-8888-4888-8888-888888888888";

const locations: StockLocationDto[] = [
  { id: "f1111111-1111-4111-8111-111111111111", code: "MAIN", name: "Main Store", kind: "folder", parentId: null, store: MAIN, active: true },
  { id: FLOOR, code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: MAIN, active: true },
  { id: BACK, code: "MAIN-BACK", name: "Back room", kind: "shelf", parentId: null, store: MAIN, active: true },
  { id: REJECTED, code: "MAIN-REJ", name: "Rejected", kind: "rejected", parentId: null, store: MAIN, active: true },
];

const user = (permissions: string[]) => ({
  id: "u1",
  firstName: "Asha",
  lastName: null,
  email: "asha@example.com",
  isOwnerAdmin: false,
  permissions,
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
});

const rice: ItemDto = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "ITM-000001",
  name: "Basmati Rice 1 kg",
  description: null,
  hasImage: false,
  itemGroup: { id: "g1", code: "RICE", name: "Rice" },
  brand: null,
  baseUnit: { id: PCS, code: "PCS", name: "Piece", allowsFractions: false },
  hsnCode: null,
  mrp: null,
  maxDiscountPercent: "0",
  isStockItem: true,
  canBuy: true,
  canSell: true,
  endDate: null,
  active: true,
  isParentStyle: false,
  parent: null,
  variantCount: 0,
  trackBatches: false,
  autoNumberBatches: true,
  shelfLifeDays: null,
  trackSerials: false,
  warrantyDays: null,
  units: [{ unitId: PCS, code: "PCS", name: "Piece", allowsFractions: false, factor: "1", mrp: null }],
  barcodes: [],
  variantAttributes: [],
  variantValues: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function receiptLine(over: Partial<GoodsReceiptLineDto> = {}): GoodsReceiptLineDto {
  return {
    id: "d1111111-1111-4111-8111-111111111111",
    lineNo: 1,
    orderLineId: null,
    order: null,
    item: { id: rice.id, code: rice.code, name: rice.name, trackBatches: false, trackSerials: false },
    unitId: PCS,
    factor: "1",
    receivedQuantity: "10.000",
    acceptedQuantity: "10.000",
    rejectedQuantity: "0",
    freeQuantity: "0",
    basicAcceptedQuantity: "10.000",
    basicRejectedQuantity: "0",
    returnedAcceptedQuantity: "0",
    returnedRejectedQuantity: "0",
    billedQuantity: "0",
    billableQuantity: "10",
    shelfLocationId: FLOOR,
    rejectedLocationId: null,
    batchId: null,
    newBatchNumber: null,
    newExpiryOn: null,
    serialNumbers: [],
    rejectedSerialNumbers: [],
    returnOfLineId: null,
    ...over,
  };
}

function receipt(over: Partial<GoodsReceiptDto> = {}): GoodsReceiptDto {
  return {
    id: RECEIPT_ID,
    number: "GRN-MAIN-2627-0001",
    status: "draft",
    isReturn: false,
    isConsignment: false,
    returnOfId: null,
    billId: null,
    supplier: SUPPLIER,
    store: MAIN,
    postingDate: "2026-10-15",
    postingAt: "2026-10-15T05:00:00.000Z",
    deliveryNoteNo: null,
    transporterName: null,
    vehicleNo: null,
    noOrderReason: null,
    billedPercent: "0.00",
    returnedPercent: "0.00",
    check: null,
    isBackDated: false,
    remarks: null,
    cancelReason: null,
    createdAt: "2026-10-15T05:00:00.000Z",
    finalisedAt: null,
    lines: [receiptLine()],
    ...over,
  };
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by "METHOD /path" (exact) or "/path" (prefix), and records them. */
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

const noOrders = () => ({ status: 200, body: { rows: [], total: 0, page: 1, pageSize: 100 } });

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

const RECEIVER = ["purchase.view", "purchase.receive"];
const MANAGER = [...RECEIVER, "purchase.receive_without_order"];

describe("receiptLineProblem", () => {
  it("refuses more rejected than received", () => {
    const line = { ...lineWithoutOrder(rice, null), received: "5", rejected: "6" };
    expect(receiptLineProblem(line)).toBe("ITM-000001: rejected (6) cannot be more than received (5)");
  });

  it("asks for one serial number per accepted and per rejected unit", () => {
    const phone = { ...rice, code: "PHN-1", trackSerials: true };
    const base = { ...lineWithoutOrder(phone, null), received: "3", rejected: "1" };
    expect(receiptLineProblem({ ...base, serials: "A1\nA2\nA3" })).toMatch(/exactly 2 serial numbers for the accepted goods/);
    expect(receiptLineProblem({ ...base, serials: "A1\nA2", rejectedSerials: "" })).toMatch(/exactly 1 serial numbers for the rejected goods/);
    expect(receiptLineProblem({ ...base, serials: "A1\nA2", rejectedSerials: "A2" })).toMatch(/listed twice/);
    expect(receiptLineProblem({ ...base, serials: "A1\nA2", rejectedSerials: "R1" })).toBeNull();
  });

  it("needs an expiry or manufacture date for items with a shelf life", () => {
    const milk = { ...rice, code: "MLK-1", trackBatches: true, shelfLifeDays: 3 };
    const base = { ...lineWithoutOrder(milk, null), received: "2" };
    expect(receiptLineProblem(base)).toMatch(/expiry date or the manufacture date/);
    expect(receiptLineProblem({ ...base, manufactureDate: "2026-10-14" })).toBeNull();
  });
});

describe("ReceiptEditor", () => {
  it("requires the reason when goods come without an order, then sends it", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      "GET /purchase/orders": noOrders,
      [`PATCH /purchase/receipts/${RECEIPT_ID}`]: () => ({ status: 200, body: receipt({ noOrderReason: "Urgent festival stock" }) }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <ReceiptEditor receipt={receipt()} locations={locations} onSaved={onSaved} />
      </AuthProvider>,
    );
    const reasonBox = await screen.findByLabelText(/Why is there no order\?/);
    expect(screen.getByText(/only by a Store Manager/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Give the reason for receiving goods without a purchase order")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);

    fireEvent.change(reasonBox, { target: { value: "Urgent festival stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [w] = writes(fetchMock);
    expect(w.path).toBe(`/purchase/receipts/${RECEIPT_ID}`);
    expect((w.body as { noOrderReason: string }).noOrderReason).toBe("Urgent festival stock");
  });

  it("sale or return: no order reason is asked, and the receipt is sent as sale or return (plan 11 part 2)", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(RECEIVER) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      "GET /purchase/orders": noOrders,
      [`PATCH /purchase/receipts/${RECEIPT_ID}`]: () => ({ status: 200, body: receipt({ isConsignment: true }) }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <ReceiptEditor receipt={receipt()} locations={locations} onSaved={onSaved} />
      </AuthProvider>,
    );
    expect(await screen.findByLabelText(/Why is there no order\?/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Sale or return/));
    expect(screen.queryByLabelText(/Why is there no order\?/)).toBeNull();
    expect(screen.queryByText("Orders waiting for goods")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [w] = writes(fetchMock);
    expect(w.body).toMatchObject({ isConsignment: true, noOrderReason: null });
  });

  it("shows sale-or-return receipts with their badge", async () => {
    mockApi({ "/auth/me": () => ({ status: 200, body: user(RECEIVER) }), "GET /purchase/orders": noOrders, [`/items/${rice.id}`]: () => ({ status: 200, body: rice }) });
    render(
      <AuthProvider>
        <ReceiptEditor receipt={receipt({ isConsignment: true })} locations={locations} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    expect((await screen.findAllByText("Sale or return")).length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/Sale or return/) as HTMLInputElement).checked).toBe(true);
  });

  it("stops rejected above received before calling the API", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      "GET /purchase/orders": noOrders,
    });
    render(
      <AuthProvider>
        <ReceiptEditor receipt={receipt({ noOrderReason: "Sample" })} locations={locations} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Rejected for line 1"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /rejected \(12\) cannot be more than received \(10\)/.test(a.textContent ?? ""))).toBe(true);
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("starts from an order: one line per open line, pending quantity as received", async () => {
    const order = {
      id: ORDER_ID,
      number: "PO-MAIN-2627-0004",
      status: "to_receive_and_bill",
      supplier: SUPPLIER,
      store: MAIN,
      orderDate: "2026-10-10",
      neededBy: "2026-10-16",
      receivedPercent: "40.00",
      billedPercent: "0.00",
      lines: [
        {
          id: ORDER_LINE_ID,
          lineNo: 1,
          item: { id: rice.id, code: rice.code, name: rice.name, isStockItem: true, trackBatches: false, trackSerials: false },
          unitId: PCS,
          factor: "1",
          quantity: "200",
          freeQuantity: "0",
          basicQuantity: "200",
          storeId: MAIN.id,
          neededBy: "2026-10-16",
          receivedQuantity: "118",
          pendingQuantity: "82",
        },
      ],
    } as unknown as PurchaseOrderDto;
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(RECEIVER) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      [`GET /purchase/orders/${ORDER_ID}/open-lines`]: () => ({ status: 200, body: order }),
      "GET /purchase/orders": noOrders,
      "POST /purchase/receipts": () => ({ status: 201, body: receipt() }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <ReceiptEditor receipt={null} orderId={ORDER_ID} locations={locations} onSaved={onSaved} />
      </AuthProvider>,
    );
    const received = (await screen.findByLabelText("Received for line 1")) as HTMLInputElement;
    expect(received.value).toBe("82");
    expect(screen.getByText(/82 still expected/)).toBeTruthy();
    // A receiver without the right to receive without an order gets no item search box and no reason box.
    expect(screen.queryByText(/came without an order/)).toBeNull();
    expect(screen.queryByLabelText(/Why is there no order\?/)).toBeNull();
    // Only the store's shelves are offered (not the Rejected location).
    const shelf = screen.getByLabelText("Shelf for line 1");
    expect(Array.from(shelf.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Default shelf", "Shop floor", "Back room"]);

    fireEvent.change(screen.getByLabelText("Rejected for line 1"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = writes(fetchMock)[0].body as { supplierId: string; storeId: string; lines: Record<string, unknown>[] };
    expect(body.supplierId).toBe(SUPPLIER.id);
    expect(body.storeId).toBe(MAIN.id);
    expect(body.lines).toEqual([{ orderLineId: ORDER_LINE_ID, itemId: rice.id, unitId: PCS, receivedQuantity: "82", freeQuantity: null, rejectedQuantity: "2" }]);
  });

  it("shows the API's over-receipt refusal when finalising", async () => {
    const message = "ITM-000001: 83 received but only 82 still expected on order PO-MAIN-2627-0004 (allowance 0%)";
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      "GET /purchase/orders": noOrders,
      [`POST /purchase/receipts/${RECEIPT_ID}/finalise`]: () => ({ status: 400, body: { statusCode: 400, message, error: "Bad Request" } }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <ReceiptEditor receipt={receipt({ noOrderReason: "Sample" })} locations={locations} onSaved={onSaved} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Finalise" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === message)).toBe(true));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("ReceiptView", () => {
  it("shows over-receipt warnings and, for a receipt of a supplier bill, the bill link and no cancel", async () => {
    mockApi({ "/auth/me": () => ({ status: 200, body: user([...MANAGER, "purchase.return", "purchase.bill"]) }) });
    const r = receipt({ status: "to_bill", billId: "99999999-9999-4999-8999-999999999999", finalisedAt: "2026-10-15T05:10:00.000Z", warnings: ["ITM-000001: 83 received but only 82 still expected; accepted above the allowance"] });
    render(
      <AuthProvider>
        <ReceiptView receipt={r} locations={locations} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText(/accepted above the allowance/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the bill" }).getAttribute("href")).toBe("/purchases/bills/99999999-9999-4999-8999-999999999999");
    await screen.findByRole("button", { name: "Return goods" });
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  it("refuses to return more accepted goods than are left", async () => {
    const fetchMock = mockApi({ "/auth/me": () => ({ status: 200, body: user([...RECEIVER, "purchase.return"]) }) });
    const r = receipt({ status: "to_bill", finalisedAt: "2026-10-15T05:10:00.000Z", lines: [receiptLine({ returnedAcceptedQuantity: "4" })] });
    render(
      <AuthProvider>
        <ReceiptView receipt={r} locations={locations} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Return goods" }));
    fireEvent.change(screen.getByLabelText(`Accepted to return for ${rice.code}`), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Damaged packs" } });
    fireEvent.click(screen.getByRole("button", { name: "Return the goods" }));
    expect(await screen.findByText(/only 6 accepted left to return/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

describe("ChargesEditor", () => {
  it("checks that hand-typed shares add up to the charges before previewing", async () => {
    const header = { ...receipt({ status: "to_bill", finalisedAt: "2026-10-15T05:10:00.000Z" }), lines: undefined };
    const dal = receiptLine({ id: "d2222222-2222-4222-8222-222222222222", lineNo: 2, item: { id: "12121212-1212-4212-8212-121212121212", code: "ITM-000002", name: "Toor Dal 1 kg", trackBatches: false, trackSerials: false } });
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["purchase.view", "purchase.charges"]) }),
      "GET /purchase/receipts": (url) => ({ status: 200, body: { rows: url.searchParams.get("status") === "to_bill" ? [header] : [], total: 1, page: 1, pageSize: 200 } }),
      [`GET /purchase/receipts/${RECEIPT_ID}`]: () => ({ status: 200, body: receipt({ status: "to_bill", lines: [receiptLine(), dal] }) }),
      "POST /purchase/charges/preview": () => ({ status: 200, body: { total: "600.00", shares: [] } }),
    });
    render(
      <AuthProvider>
        <ChargesEditor onSaved={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByLabelText(/Add GRN-MAIN-2627-0001/));
    fireEvent.change(screen.getByLabelText("Description of charge 1"), { target: { value: "Lorry freight" } });
    fireEvent.change(screen.getByLabelText("Amount of charge 1"), { target: { value: "600" } });
    fireEvent.click(screen.getByLabelText(/By hand/));
    fireEvent.change(await screen.findByLabelText("Share for GRN-MAIN-2627-0001 ITM-000001"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Share for GRN-MAIN-2627-0001 ITM-000002"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Shares add up to 500.00, not 600.00")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);

    // Within ₹0.02 is accepted and the preview is asked for.
    fireEvent.change(screen.getByLabelText("Share for GRN-MAIN-2627-0001 ITM-000002"), { target: { value: "199.99" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    const body = writes(fetchMock)[0].body as { shareBy: string; manualShares: { amount: string }[] };
    expect(body.shareBy).toBe("manual");
    expect(body.manualShares.map((s) => s.amount)).toEqual(["400", "199.99"]);
  });
});
