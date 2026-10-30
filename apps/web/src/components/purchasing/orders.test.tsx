// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import type { PurchaseOrderDto, PurchaseOrderLineDto } from "@/lib/purchasing";
import type { ItemDto } from "@/lib/types";
import { OrdersEditor } from "./orders-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const SUPPLIER = { id: "99999999-9999-4999-8999-999999999999", code: "SUP-0001", name: "Sri Murugan Traders" };
const PCS = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "e1111111-1111-4111-8111-111111111111";
const LINE_ID = "d1111111-1111-4111-8111-111111111111";

const user = (permissions: string[]) => ({
  id: "u1",
  firstName: "Asha",
  lastName: null,
  email: "asha@example.com",
  isOwnerAdmin: false,
  permissions,
  allStores: false,
  stores: [{ ...MAIN, isDefault: true }],
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

const prices = {
  rate: "95.00",
  discountPercent: "0.00",
  discountAmount: "0.00",
  taxableAmount: "19000.00",
  gstRate: "5",
  cgst: "475.00",
  sgst: "475.00",
  igst: "0.00",
  lineTotal: "19950.00",
  billedAmount: "0.00",
  pendingAmount: "19000.00",
};

function line(over: Partial<PurchaseOrderLineDto> = {}, withPrices = true): PurchaseOrderLineDto {
  return {
    id: LINE_ID,
    lineNo: 1,
    item: { id: rice.id, code: rice.code, name: rice.name, isStockItem: true, trackBatches: false, trackSerials: false },
    unitId: PCS,
    factor: "1",
    quantity: "200",
    freeQuantity: "0",
    basicQuantity: "200",
    storeId: MAIN.id,
    neededBy: "2026-10-22",
    receivedQuantity: "0",
    pendingQuantity: "200",
    ...(withPrices ? prices : {}),
    ...over,
  };
}

function order(over: Partial<PurchaseOrderDto> = {}, withPrices = true): PurchaseOrderDto {
  return {
    id: ORDER_ID,
    number: "PO-MAIN-2627-0001",
    status: "draft",
    supplier: SUPPLIER,
    store: MAIN,
    orderDate: "2026-10-15",
    neededBy: "2026-10-22",
    dueDate: null,
    supplierQuoteRef: null,
    paymentTermsId: null,
    receivedPercent: "0.00",
    billedPercent: "0.00",
    overdue: false,
    ...(withPrices ? { taxableAmount: "19000.00", taxAmount: "950.00", roundingAdjustment: "0.00", total: "19950.00" } : {}),
    approvedAboveLimit: false,
    holdReason: null,
    closeReason: null,
    cancelReason: null,
    remarks: null,
    createdAt: "2026-10-15T05:00:00.000Z",
    finalisedAt: null,
    lines: [line({}, withPrices)],
    ...over,
  };
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by method and path ("POST /purchase/orders") or path alone, and records them. */
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

function writes(fn: ReturnType<typeof vi.fn>): { method: string; path: string; body: Record<string, unknown> | undefined }[] {
  return fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") !== "GET")
    .map((c) => ({ method: c.init!.method!, path: c.url.pathname, body: c.init?.body ? JSON.parse(String(c.init.body)) : undefined }));
}

function renderEditor(permissions: string[], dto: PurchaseOrderDto, onSaved = vi.fn()) {
  const fetchMock = mockApi({
    "/auth/me": () => ({ status: 200, body: user(permissions) }),
    [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
    [`PATCH /purchase/orders/${ORDER_ID}`]: () => ({ status: 200, body: dto }),
  });
  render(
    <AuthProvider>
      <OrdersEditor order={dto} onSaved={onSaved} />
    </AuthProvider>,
  );
  return { fetchMock, onSaved };
}

const buttonNames = () => screen.getAllByRole("button").map((b) => b.textContent);

beforeAll(() => {
  // jsdom has no <dialog>.showModal.
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

describe("OrdersEditor", () => {
  it("hides rates, GST and totals without the right to see buying prices", async () => {
    renderEditor(["purchase.view", "purchase.order"], order({}, false));
    await screen.findByLabelText("Quantity for line 1");
    expect(screen.queryByLabelText(/Rate per/)).toBeNull();
    expect(screen.queryByLabelText(/GST percent/)).toBeNull();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Rate (₹)");
    expect(headers).not.toContain("Line total");
    expect(screen.queryByText("Order total")).toBeNull();
    expect(buttonNames()).toEqual(expect.arrayContaining(["Save draft", "Finalise", "Cancel order"]));
  });

  it("shows a clearly marked estimate while editing and the server's total otherwise", async () => {
    renderEditor(["purchase.view", "purchase.order", "buying_prices.view"], order());
    // The totals box shows the server's figures against their own labels.
    const totals = (await screen.findByText("Order total")).closest(".card")!;
    const pairs = [...totals.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(pairs).toEqual([
      ["Taxable value", "₹19,000.00"],
      ["GST", "₹950.00"],
      ["Rounding", "₹0.00"],
      ["Total", "₹19,950.00"],
    ]);
    expect(screen.queryByText(/estimate/i)).toBeNull();

    // 200 × ₹90 less 10% = ₹16,200.00 taxable; 5% GST = ₹810.00; total ₹17,010.00.
    fireEvent.change(screen.getByLabelText("Rate per PCS for line 1"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Discount percent for line 1"), { target: { value: "10" } });
    expect(screen.getByText("₹17,010.00 (estimate)")).toBeTruthy();
    const estimate = screen.getByLabelText("Estimate of your changes");
    expect(estimate.textContent).toContain("taxable ₹16,200.00");
    expect(estimate.textContent).toContain("GST ₹810.00");
    expect(estimate.textContent).toContain("total ₹17,010.00");
  });

  it("offers the right actions for an order waiting for goods", async () => {
    renderEditor(["purchase.view", "purchase.order", "purchase.approve", "purchase.receive"], order({ status: "to_receive_and_bill", receivedPercent: "60.00" }));
    await screen.findByLabelText("Quantity for line 1");
    const names = buttonNames();
    expect(names).toEqual(expect.arrayContaining(["Change order", "Hold", "Close", "Cancel order"]));
    expect(names).not.toContain("Finalise");
    expect(names).not.toContain("Save draft");
    expect(names).not.toContain("Release");
    const receive = screen.getByRole("link", { name: "Receive goods" });
    expect(receive.getAttribute("href")).toBe(`/purchases/receipts/new?orderId=${ORDER_ID}`);
    expect(screen.getByText("60%")).toBeTruthy();
    expect((screen.getByLabelText("Quantity for line 1") as HTMLInputElement).disabled).toBe(true);
  });

  it("offers only Release and Close (with approve) for an order on hold, and nothing to staff without approve", async () => {
    renderEditor(["purchase.view", "purchase.approve"], order({ status: "on_hold", holdReason: "Price under discussion" }));
    await screen.findByLabelText("Quantity for line 1");
    expect(screen.getByText("Price under discussion")).toBeTruthy();
    const names = buttonNames();
    expect(names).toEqual(expect.arrayContaining(["Release", "Close"]));
    expect(names).not.toContain("Hold");
    expect(names).not.toContain("Cancel order");
    expect(names).not.toContain("Change order");
    expect(screen.queryByRole("link", { name: "Receive goods" })).toBeNull();
    cleanup();

    renderEditor(["purchase.view"], order({ status: "closed", closeReason: "Supplier out of stock" }));
    await screen.findByText("Supplier out of stock");
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("saving only the details of a draft leaves the lines (and their prices) alone", async () => {
    const { fetchMock, onSaved } = renderEditor(["purchase.view", "purchase.order"], order({}, false));
    fireEvent.change(await screen.findByLabelText(/Supplier's quotation ref/), { target: { value: "Q-778" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].body?.supplierQuoteRef).toBe("Q-778");
    expect(sent[0].body).not.toHaveProperty("lines");
  });

  it("changing a finalised order needs a reason and sends the existing line ids", async () => {
    const dto = order({ status: "to_receive_and_bill" });
    const { fetchMock, onSaved } = renderEditor(["purchase.view", "purchase.order", "buying_prices.view"], dto);
    fireEvent.click(await screen.findByRole("button", { name: "Change order" }));
    fireEvent.change(screen.getByLabelText("Quantity for line 1"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Say why the order is being changed")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Why is the order being changed/), { target: { value: "Supplier offered more" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].body?.changeReason).toBe("Supplier offered more");
    expect(sent[0].body).not.toHaveProperty("supplierId");
    expect(sent[0].body?.lines).toEqual([{ lineId: LINE_ID, itemId: rice.id, unitId: PCS, quantity: "250", rate: "95.00", gstRate: "5" }]);
  });

  it("shows the API's refusal for a held supplier when finalising", async () => {
    const message = "Supplier SUP-0001 is on hold for orders and bills";
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["purchase.view", "purchase.order"]) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      [`POST /purchase/orders/${ORDER_ID}/finalise`]: () => ({ status: 400, body: { statusCode: 400, message, error: "Bad Request" } }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <OrdersEditor order={order({}, false)} onSaved={onSaved} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Finalise" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === message)).toBe(true));
    expect(writes(fetchMock).map((w) => `${w.method} ${w.path}`)).toEqual([`POST /purchase/orders/${ORDER_ID}/finalise`]);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
