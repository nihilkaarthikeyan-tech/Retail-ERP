// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import type { ItemDto, StockDocumentDto, StockLocationDto } from "@/lib/types";
import { ReceiveDialog } from "./receive-dialog";
import { StockDocumentEditor } from "./stock-document-editor";
import { StockOnHand } from "./stock-on-hand";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const ANNA = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "ANNA", name: "Anna Nagar" };
const FLOOR = "c1111111-1111-4111-8111-111111111111";
const ANNA_FLOOR = "c2222222-2222-4222-8222-222222222222";
const TRANSIT = "c3333333-3333-4333-8333-333333333333";
const PCS = "22222222-2222-4222-8222-222222222222";

const locations: StockLocationDto[] = [
  { id: "f1111111-1111-4111-8111-111111111111", code: "MAIN", name: "Main Store", kind: "folder", parentId: null, store: MAIN, active: true },
  { id: FLOOR, code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: "f1111111-1111-4111-8111-111111111111", store: MAIN, active: true },
  { id: ANNA_FLOOR, code: "ANNA-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: ANNA, active: true },
  { id: TRANSIT, code: "TRANSIT", name: "Transit", kind: "transit", parentId: null, store: null, active: true },
];

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

function line(over: Partial<StockDocumentDto["lines"][number]> = {}): StockDocumentDto["lines"][number] {
  return {
    id: "d1111111-1111-4111-8111-111111111111",
    lineNo: 1,
    item: { id: rice.id, code: rice.code, name: rice.name, trackBatches: false, trackSerials: false },
    unitId: PCS,
    quantity: "1.000",
    factor: "1",
    basicQuantity: "1.000",
    batch: null,
    newBatchNumber: null,
    newExpiryOn: null,
    serialNumbers: [],
    expectedQuantity: null,
    countedQuantity: null,
    receivedQuantity: "0",
    sendLineId: null,
    ...over,
  };
}

function doc(over: Partial<StockDocumentDto> = {}): StockDocumentDto {
  return {
    id: "e1111111-1111-4111-8111-111111111111",
    number: "SO-MAIN-0001",
    kind: "stock_out",
    reason: "damage",
    countType: null,
    status: "draft",
    postingDate: "2026-10-15",
    postingAt: "2026-10-15T05:00:00.000Z",
    storeId: MAIN.id,
    toStoreId: null,
    fromLocationId: FLOOR,
    toLocationId: null,
    sendDocumentId: null,
    remarks: null,
    isBackDated: false,
    cancelReason: null,
    createdAt: "2026-10-15T05:00:00.000Z",
    finalisedAt: null,
    blind: false,
    lines: [line()],
    ...over,
  };
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by method and path ("POST /stock/documents") or path alone, and records them. */
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

describe("StockDocumentEditor", () => {
  it("refuses 1.5 pieces before sending anything", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user([], true) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <StockDocumentEditor kind="stock_out" doc={doc()} locations={locations} receivingStores={[MAIN, ANNA]} onSaved={onSaved} />
      </AuthProvider>,
    );
    const save = await screen.findByRole("button", { name: "Save draft" });
    fireEvent.change(screen.getByLabelText("Quantity for line 1"), { target: { value: "1.5" } });
    fireEvent.click(save);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /PCS is counted in whole numbers; 1\.5 is not allowed/.test(a.textContent ?? ""))).toBe(true);
    expect(writes(fetchMock)).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the stock engine's refusal when finalising", async () => {
    const message = "Not enough stock of ITM-000001 at MAIN Shop floor: 127 available, 73 more needed";
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user([], true) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
      [`POST /stock/documents/${doc().id}/finalise`]: () => ({ status: 400, body: { statusCode: 400, message, error: "Bad Request" } }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <StockDocumentEditor kind="stock_out" doc={doc({ lines: [line({ quantity: "200", basicQuantity: "200" })] })} locations={locations} receivingStores={[MAIN, ANNA]} onSaved={onSaved} />
      </AuthProvider>,
    );
    await screen.findByLabelText("Quantity for line 1");
    fireEvent.click(await screen.findByRole("button", { name: "Finalise" }));

    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === message)).toBe(true));
    expect(writes(fetchMock).map((w) => `${w.method} ${w.path}`)).toEqual([`POST /stock/documents/${doc().id}/finalise`]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("offers only non-folder, non-transit locations of the chosen store", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user([], true) }),
      [`/items/${rice.id}`]: () => ({ status: 200, body: rice }),
    });
    render(
      <AuthProvider>
        <StockDocumentEditor kind="stock_out" doc={doc()} locations={locations} receivingStores={[MAIN, ANNA]} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    const from = await screen.findByLabelText(/From location/);
    const options = within(from).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose…", "Shop floor"]);
  });
});

describe("ReceiveDialog", () => {
  it("defaults each line to what is still in transit and posts the send line ids", async () => {
    const lineA = line({ id: "a0000000-0000-4000-8000-00000000000a", quantity: "20", basicQuantity: "20.000", receivedQuantity: "15.000" });
    const lineB = line({ id: "b0000000-0000-4000-8000-00000000000b", lineNo: 2, quantity: "10", basicQuantity: "10.000", receivedQuantity: "0" });
    const send = doc({ kind: "transfer_send", reason: null, status: "finalised", number: "TR-MAIN-0001", toStoreId: ANNA.id, toLocationId: TRANSIT, lines: [lineA, lineB] });
    const receipt = doc({ id: "f0000000-0000-4000-8000-000000000001", kind: "transfer_receive", status: "finalised", number: "RC-ANNA-0001" });
    const fetchMock = mockApi({
      [`POST /stock/transfers/${send.id}/receive`]: () => ({ status: 200, body: receipt }),
    });
    const onReceived = vi.fn();
    render(<ReceiveDialog send={send} locations={locations} onClose={vi.fn()} onReceived={onReceived} />);

    const inputs = screen.getAllByLabelText(/Quantity to receive/) as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["5", "10"]);
    // Only ANNA's own shelves are offered as the destination.
    const dest = screen.getByLabelText(/Put the goods in/);
    expect(within(dest).getAllByRole("option").map((o) => o.textContent)).toEqual(["Default location", "Shop floor"]);

    fireEvent.change(inputs[1], { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));

    await waitFor(() => expect(onReceived).toHaveBeenCalledWith(receipt));
    const posted = writes(fetchMock);
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe(`/stock/transfers/${send.id}/receive`);
    expect((posted[0].body as { lines: unknown[] }).lines).toEqual([
      { sendLineId: lineA.id, quantity: "5" },
      { sendLineId: lineB.id, quantity: "4" },
    ]);
  });

  it("refuses more than is still in transit without calling the API", async () => {
    const lineA = line({ id: "a0000000-0000-4000-8000-00000000000a", quantity: "20", basicQuantity: "20", receivedQuantity: "15" });
    const send = doc({ kind: "transfer_send", status: "finalised", toStoreId: ANNA.id, lines: [lineA] });
    const fetchMock = mockApi({});
    render(<ReceiveDialog send={send} locations={locations} onClose={vi.fn()} onReceived={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Quantity to receive/), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(await screen.findByText(/only 5 still in transit/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

describe("StockOnHand", () => {
  const row = { item: { id: rice.id, code: rice.code, name: rice.name, unit: "PCS" }, location: { id: FLOOR, code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", store: MAIN }, quantity: "127.000" };

  it("hides cost and value columns when the API leaves them out", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(["stock.view"]) }),
      "/stock/locations": () => ({ status: 200, body: locations }),
      "/stock/balance": () => ({ status: 200, body: { rows: [row], totals: {} } }),
    });
    render(
      <AuthProvider>
        <StockOnHand />
      </AuthProvider>,
    );
    expect(await screen.findByText("Basmati Rice 1 kg")).toBeTruthy();
    expect(screen.getByText("127")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Value");
    expect(headers).not.toContain("Cost per unit");
    expect(screen.queryByText(/Total value/)).toBeNull();
  });

  it("shows cost, value and the total when the user may see them", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(["stock.view", "stock.cost.view"]) }),
      "/stock/locations": () => ({ status: 200, body: locations }),
      "/stock/balance": () => ({ status: 200, body: { rows: [{ ...row, unitCost: "92.0000", value: "11684.00" }], totals: { value: "11684.00" } } }),
    });
    render(
      <AuthProvider>
        <StockOnHand />
      </AuthProvider>,
    );
    expect(await screen.findByText("₹11,684.00")).toBeTruthy();
    expect(screen.getByText("₹92.00")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Value");
    expect(headers).toContain("Cost per unit");
    expect(screen.getByText("Total value: ₹11,684.00")).toBeTruthy();
  });
});
