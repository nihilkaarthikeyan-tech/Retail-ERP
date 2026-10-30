// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier sale-or-return screens (plan 11 part 2 §3, scenario 11.23).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { MENU } from "@/lib/menu";
import { ConsignmentOverview, type ConsignmentStatementDto, ConsignmentStatementView, type ConsignmentStockDto } from "./consignment";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/purchases/consignment",
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const FANCY = { id: "55555555-5555-4555-8555-555555555555", code: "SUP-0001", name: "Fancy World" };
const BAG = { id: "11111111-1111-4111-8111-111111111111", code: "ITM-000001", name: "Ladies handbag" };
const STATEMENT_ID = "99999999-9999-4999-8999-999999999999";

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

const MANAGER = ["purchase.view", "purchase.bill", "buying_prices.view"];

const stock: ConsignmentStockDto = {
  rows: [
    {
      supplier: FANCY,
      store: MAIN,
      heldQuantity: "10",
      heldValue: "3000.00",
      soldNotSettledQuantity: "1",
      soldNotSettledAmount: "300.00",
      owed: "3000.00",
      items: [{ item: BAG, heldQuantity: "10", heldValue: "3000.00", soldNotSettledQuantity: "1", soldNotSettledAmount: "300.00", owed: "3000.00" }],
    },
  ],
  totals: { heldQuantity: "10", heldValue: "3000.00", soldNotSettledQuantity: "1", soldNotSettledAmount: "300.00", owed: "3000.00" },
  check: { fromGoods: "3000.00", ledger: "3000.00", difference: "0.00", ok: true },
};

function statement(over: Partial<ConsignmentStatementDto> = {}): ConsignmentStatementDto {
  return {
    id: STATEMENT_ID,
    number: "CS-MAIN-2026-27-00001",
    status: "draft",
    supplier: FANCY,
    store: MAIN,
    fromDate: "2026-10-01",
    toDate: "2026-10-16",
    remarks: null,
    bill: null,
    amount: "2100.00",
    createdAt: "2026-10-16T05:00:00.000Z",
    lines: [{ item: BAG, received: "20", sold: "7", returned: "3", held: "10", rate: "300.00", amount: "2100.00" }],
    ...over,
  };
}

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ?? Object.entries(routes).find(([key]) => !key.includes(" ") && url.pathname === key);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function writes(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") !== "GET")
    .map((c) => ({ path: c.url.pathname, body: c.init?.body ? JSON.parse(String(c.init.body)) : undefined }));
}

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

describe("Sale or return menu entry", () => {
  it("is under Purchases for anyone who sees purchases", () => {
    const entry = MENU.find((m) => m.href === "/purchases/consignment");
    expect(entry).toMatchObject({ label: "Sale or return", section: "Purchases", permissions: ["purchase.view"] });
  });
});

describe("ConsignmentOverview", () => {
  it("shows held and sold-not-settled amounts by supplier, the balance check and the statements", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      "/purchase/consignment/stock": () => ({ status: 200, body: stock }),
      "/purchase/consignment/statements": () => ({ status: 200, body: [statement({ status: "billed", bill: { id: "b1", number: "PB-2026-27-00001", status: "unpaid", total: "2100.00" } })] }),
      "/stock/locations": () => ({ status: 200, body: [{ id: "f1", code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: MAIN, active: true }] }),
    });
    render(
      <AuthProvider>
        <ConsignmentOverview />
      </AuthProvider>,
    );
    expect((await screen.findAllByText("₹3,000.00")).length).toBe(2); // held value and owed
    // The supplier's row in "Held by supplier": each amount sits in its own column.
    const held = screen.getAllByRole("table")[0];
    const headers = [...held.querySelectorAll("th")].map((h) => h.textContent);
    const cells = [...held.querySelectorAll("tbody tr")[0].querySelectorAll("td")].map((c) => c.textContent);
    expect(headers).toEqual(["Supplier", "Store", "Held", "Held value", "Sold, not settled", "Sold amount", "Owed on consignment"]);
    expect(cells).toEqual([FANCY.name, MAIN.code, "10", "₹3,000.00", "1", "₹300.00", "₹3,000.00"]);
    expect(await screen.findByText(/agree with the "Owed to suppliers on consignment" account/)).toBeTruthy();
    expect(await screen.findByText("CS-MAIN-2026-27-00001")).toBeTruthy();
    expect(screen.getByText("PB-2026-27-00001")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make statement" })).toBeTruthy();
  });

  it("warns when the goods and the account disagree", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      "/purchase/consignment/stock": () => ({ status: 200, body: { ...stock, check: { fromGoods: "3000.00", ledger: "2999.00", difference: "-1.00", ok: false } } }),
      "/purchase/consignment/statements": () => ({ status: 200, body: [] }),
      "/stock/locations": () => ({ status: 200, body: [] }),
    });
    render(
      <AuthProvider>
        <ConsignmentOverview />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Please tell the\s+Accountant/)).toBeTruthy();
  });

  it("asks for the supplier before making a statement, without calling the API", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      "/purchase/consignment/stock": () => ({ status: 200, body: stock }),
      "/purchase/consignment/statements": () => ({ status: 200, body: [] }),
      "/stock/locations": () => ({ status: 200, body: [{ id: "f1", code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: MAIN, active: true }] }),
    });
    render(
      <AuthProvider>
        <ConsignmentOverview />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Make statement" }));
    expect(await screen.findByText("Choose the supplier")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

describe("ConsignmentStatementView", () => {
  it("shows received 20, sold 7, returned 3, held 10 and makes the bill with the supplier's number", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(MANAGER) }),
      [`POST /purchase/consignment/statements/${STATEMENT_ID}/bill`]: () => ({
        status: 200,
        body: statement({ status: "billed", bill: { id: "b1", number: "PB-2026-27-00001", status: "unpaid", total: "2100.00" } }),
      }),
    });
    const onChanged = vi.fn();
    render(
      <AuthProvider>
        <ConsignmentStatementView statement={statement()} onChanged={onChanged} />
      </AuthProvider>,
    );
    const row = (await screen.findByText(`${BAG.code} ${BAG.name}`)).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([`${BAG.code} ${BAG.name}`, "20", "7", "3", "10", "₹300.00", "₹2,100.00"]);
    expect(screen.getByText("Amount for the sold goods: ₹2,100.00")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Make bill" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Supplier's bill number"), { target: { value: "FW/SOR/1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make bill" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [w] = writes(fetchMock);
    expect(w.path).toBe(`/purchase/consignment/statements/${STATEMENT_ID}/bill`);
    expect(w.body).toMatchObject({ supplierBillNo: "FW/SOR/1" });
  });

  it("a billed statement offers only Cancel, explaining that its bill goes too", async () => {
    mockApi({ "/auth/me": () => ({ status: 200, body: user(MANAGER) }) });
    render(
      <AuthProvider>
        <ConsignmentStatementView statement={statement({ status: "billed", bill: { id: "b1", number: "PB-2026-27-00001", status: "unpaid", total: "2100.00" } })} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    await screen.findByText("PB-2026-27-00001");
    expect(screen.queryByRole("button", { name: "Make bill" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel statement" }));
    expect(await screen.findByText(/Its supplier bill is cancelled too/)).toBeTruthy();
  });

  it("people without the bill right only look", async () => {
    mockApi({ "/auth/me": () => ({ status: 200, body: user(["purchase.view"]) }) });
    render(
      <AuthProvider>
        <ConsignmentStatementView statement={statement()} onChanged={vi.fn()} />
      </AuthProvider>,
    );
    await screen.findByText(`${BAG.code} ${BAG.name}`);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Make bill" })).toBeNull());
    expect(screen.queryByText(/Amount for the sold goods/)).toBeNull();
  });
});
