// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 part 2 back office: customer orders (advances held, order slip) and
// alteration jobs (overdue list, the next step with who and when).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { visibleMenu } from "@/lib/menu";
import type { AlterationDto, OrderDto } from "@/lib/orders";
import { AlterationsScreen } from "./alteration-screens";
import { OrdersScreen } from "./order-screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const locations = [{ id: "l1", code: "MAIN-FLOOR", name: "Floor", kind: "shelf", active: true, parentId: null, store: MAIN }];

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

const user = (permissions: string[]) => ({ id: "u1", firstName: "Asha", lastName: null, email: "a@x.in", isOwnerAdmin: false, permissions, allStores: true, stores: [], mustChangePassword: false, roles: [] });

describe("menu", () => {
  it("shows customer orders and alterations to those with the rights", () => {
    const hrefs = (p: string[]) => visibleMenu(user(p) as never).map((m) => m.href);
    expect(hrefs(["orders.manage", "alterations.manage"])).toEqual(expect.arrayContaining(["/orders", "/alterations"]));
    expect(hrefs(["pos.sell"])).not.toContain("/orders");
  });
});

const order: OrderDto = {
  id: "o1",
  number: "CO-2026-27-00001",
  status: "open",
  store: MAIN,
  storeId: MAIN.id,
  customer: { id: "c1", code: "CUS-000002", name: "Priya", mobile: "9840012345" },
  customerId: "c1",
  expectedOn: "2026-10-20",
  overdue: false,
  total: "2499.00",
  advanceReceived: "1000.00",
  advanceRefunded: "0.00",
  advanceHeld: "1000.00",
  readyAt: null,
  collectedAt: null,
  collectedBill: null,
  cancelledAt: null,
  cancelReason: null,
  advanceOutcome: null,
  remarks: null,
  createdAt: "2026-10-16T05:00:00.000Z",
};

describe("OrdersScreen", () => {
  it("lists orders, shows the advances held and marks an open order ready", async () => {
    const fetchMock = mockApi({
      "/stock/locations": () => ({ status: 200, body: locations }),
      "/orders": (url) => ({ status: 200, body: { rows: [order], total: 1, ...(url.searchParams.get("view") === "advances" ? { advancesHeld: "1000.00" } : {}) } }),
      "GET /orders/o1": () => ({ status: 200, body: { ...order, lines: [{ id: "ol1", lineNo: 1, item: { id: "i1", code: "ITM-000001", name: "Silk kurta, XL" }, unitId: "u", unitCode: "PCS", quantity: "1", price: "2499.00", amount: "2499.00", remarks: null, setAside: "0" }], payments: [] } }),
      "POST /orders/o1/ready": () => ({ status: 200, body: { ...order, status: "ready", lines: [], payments: [] } }),
    });
    render(<OrdersScreen />);
    expect(await screen.findByText("CO-2026-27-00001")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "advances" } });
    expect((await screen.findByTestId("advances-held")).textContent).toContain("1,000.00");
    fireEvent.click(screen.getByText("CO-2026-27-00001"));
    fireEvent.click(await screen.findByText("Goods arrived: mark ready"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/orders/o1/ready") && (c[1] as RequestInit).method === "POST")).toBe(true));
    expect(screen.getByText("Print the order slip").getAttribute("href")).toBe("/print/customer_order/o1");
  });
});

const job: AlterationDto = {
  id: "j1",
  number: "ALT-2026-27-00001",
  status: "with_tailor",
  store: MAIN,
  storeId: MAIN.id,
  customerId: null,
  name: "Karthik",
  phone: "9840098400",
  bill: { id: "b1", number: "MAIN-T1-2026-27-000010" },
  tailorStaffId: null,
  tailorName: "Murugan",
  tailor: "Murugan",
  promisedOn: "2026-10-15",
  dueToday: false,
  overdue: true,
  charge: "150.00",
  chargePaidWith: "collection",
  chargeBill: null,
  deliveredAt: null,
  remarks: null,
  createdAt: "2026-10-13T05:00:00.000Z",
  lines: [{ id: "jl1", lineNo: 1, itemId: null, item: null, garment: "Trouser", work: "Shorten 2 cm" }],
  history: [
    { status: "received", at: "2026-10-13T05:00:00.000Z", byId: "u1", by: "Asha", remarks: null },
    { status: "with_tailor", at: "2026-10-13T06:00:00.000Z", byId: "u1", by: "Asha", remarks: null },
  ],
};

describe("AlterationsScreen", () => {
  it("shows an overdue job with its history and moves it to ready", async () => {
    const fetchMock = mockApi({
      "/stock/locations": () => ({ status: 200, body: locations }),
      "/alterations": () => ({ status: 200, body: { rows: [job], total: 1 } }),
      "GET /alterations/j1": () => ({ status: 200, body: job }),
      "POST /alterations/j1/status": () => ({ status: 200, body: { ...job, status: "ready", history: [...job.history, { status: "ready", at: "2026-10-16T05:00:00.000Z", byId: "u1", by: "Asha", remarks: null }] } }),
    });
    render(<AlterationsScreen />);
    expect(await screen.findByText("Overdue")).toBeTruthy();
    fireEvent.click(screen.getByText("ALT-2026-27-00001"));
    expect((await screen.findByLabelText("History")).textContent).toContain("With the tailor");
    fireEvent.click(screen.getByText("Back from the tailor: ready"));
    await waitFor(() => expect(screen.getByLabelText("History").textContent).toContain("Ready"));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ status: "ready", remarks: null });
    expect(screen.getByText("Print the garment tag").getAttribute("href")).toBe("/print/alteration_tag/j1");
  });
});
