// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { getTillDevice } from "@/lib/till-device";
import { CancelBillDialog } from "./cancel-bill-dialog";
import { GstRatesView } from "./gst-rates";
import { OfferForm } from "./offer-form";
import type { GstRateDto, PosBillDto, TillDto } from "./pos-shared";
import { TillDeviceBox } from "./till-device-box";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", name: "Main Store" };
const TILL_ID = "71111111-1111-4111-8111-111111111111";
const MANAGER_ID = "a1111111-1111-4111-8111-111111111111";
const GROUP_ID = "91111111-1111-4111-8111-111111111111";

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

const till: TillDto = {
  id: TILL_ID,
  code: "T1",
  name: "Front counter",
  store: MAIN,
  locationId: "c1111111-1111-4111-8111-111111111111",
  priceListId: "p1111111-1111-4111-8111-111111111111",
  numberPrefix: "MAIN-T1",
  cashierDiscountPercent: "5",
  allowPriceChange: false,
  autoPrint: true,
  receiptFooter: null,
  active: true,
  paymentMethods: [],
  devices: [{ id: "d1", deviceName: "Old counter PC", lastSeenAt: null }],
};

function rate(over: Partial<GstRateDto> = {}): GstRateDto {
  return { id: "r1111111-1111-4111-8111-111111111111", hsnCode: "1006", rate: "5", cessRate: "0", effectiveFrom: "2026-04-01", approved: false, approvedAt: null, approvedById: null, note: null, ...over };
}

const bill: PosBillDto = {
  id: "b1111111-1111-4111-8111-111111111111",
  number: "MAIN-T1-2627-000001",
  kind: "sale",
  status: "completed",
  till: { id: TILL_ID, code: "T1", name: "Front counter" },
  shiftId: "s1",
  returnOfId: null,
  exchangeId: null,
  customerId: null,
  cashierId: "u1",
  soldAt: "2026-10-15T05:00:00.000Z",
  businessDate: "2026-10-15",
  grossAmount: "372.00",
  discountAmount: "0.00",
  billDiscount: "0.00",
  taxableAmount: "340.43",
  cgst: "15.79",
  sgst: "15.78",
  igst: "0.00",
  roundingAdjustment: "0.00",
  total: "372.00",
  changeAmount: "128.00",
  offline: false,
  checkFlags: [],
  gstProvisional: true,
  returnReason: null,
  cancelReason: null,
  reprints: 0,
  lines: [],
  payments: [],
};

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by method and path ("POST /pos/approvals") or path alone. */
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

function writes(fn: ReturnType<typeof vi.fn>): { path: string; body: Record<string, unknown> }[] {
  return fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") !== "GET")
    .map((c) => ({ path: c.url.pathname, body: c.init?.body ? JSON.parse(String(c.init.body)) : {} }));
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
  localStorage.clear();
});

describe("TillDeviceBox", () => {
  it("warns that the old computer stops working, registers and stores the token on this computer", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["pos.setup"]) }),
      [`POST /pos/tills/${TILL_ID}/register`]: () => ({ status: 201, body: { deviceId: "d2", token: "secret-device-token" } }),
    });
    const onRegistered = vi.fn();
    render(
      <AuthProvider>
        <TillDeviceBox till={till} canSetup onRegistered={onRegistered} />
      </AuthProvider>,
    );
    expect(screen.getByText(/Old counter PC/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name of this computer"), { target: { value: "Counter 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this computer as till T1" }));
    expect(await screen.findByText(/Old counter PC\) will stop working as till T1/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Yes, use this computer" }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    expect(writes(fetchMock)).toEqual([{ path: `/pos/tills/${TILL_ID}/register`, body: { deviceName: "Counter 1" } }]);
    expect(getTillDevice()).toEqual({ tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "secret-device-token" });
    expect(await screen.findByText("This computer is till T1.")).toBeTruthy();
  });
});

describe("GstRatesView", () => {
  it("shows no Approve button without the approve right", async () => {
    mockApi({
      "/auth/me": () => ({ status: 200, body: user(["gst_rates.manage"]) }),
      "/pos/gst-rates": () => ({ status: 200, body: [rate()] }),
    });
    render(
      <AuthProvider>
        <GstRatesView />
      </AuthProvider>,
    );
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByText("Not approved yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("approves only after the accountant's sign-off is confirmed, and never offers it for an approved rate", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["gst_rates.approve"]) }),
      "/pos/gst-rates": () => ({ status: 200, body: [rate(), rate({ id: "r2222222-2222-4222-8222-222222222222", hsnCode: "3402", rate: "18", approved: true, approvedAt: "2026-10-01T05:00:00.000Z" })] }),
      [`POST /pos/gst-rates/${rate().id}/approve`]: () => ({ status: 200, body: rate({ approved: true }) }),
    });
    render(
      <AuthProvider>
        <GstRatesView />
      </AuthProvider>,
    );
    const approveButtons = await screen.findAllByRole("button", { name: "Approve" });
    expect(approveButtons).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(approveButtons[0]);
    expect(await screen.findByText(/Chartered Accountant has signed off/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, the accountant has signed off" }));
    await waitFor(() => expect(writes(fetchMock)).toEqual([{ path: `/pos/gst-rates/${rate().id}/approve`, body: {} }]));
  });
});

describe("CancelBillDialog", () => {
  function setup(approval: Route) {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["pos.sell"]) }),
      [`/pos/tills/${TILL_ID}/people`]: () => ({ status: 200, body: { managers: [{ id: MANAGER_ID, name: "Ravi Manager" }], cashiers: [] } }),
      "POST /pos/approvals": approval,
      [`POST /pos/bills/${bill.id}/cancel`]: () => ({ status: 200, body: { repeated: false, sale: { ...bill, status: "cancelled" }, return: null } }),
    });
    const onCancelled = vi.fn();
    render(
      <AuthProvider>
        <CancelBillDialog bill={bill} open onClose={vi.fn()} onCancelled={onCancelled} />
      </AuthProvider>,
    );
    return { fetchMock, onCancelled };
  }

  it("sends nothing until a manager and PIN are given", async () => {
    const { fetchMock, onCancelled } = setup(() => ({ status: 200, body: { token: "approval-1", manager: { id: MANAGER_ID, name: "Ravi Manager" } } }));
    await screen.findByRole("option", { name: "Ravi Manager" });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Customer changed their mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the bill" }));
    expect(await screen.findByText("Choose the manager who approves.")).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it("asks for the manager's approval first and cancels with its token", async () => {
    const { fetchMock, onCancelled } = setup(() => ({ status: 200, body: { token: "approval-1", manager: { id: MANAGER_ID, name: "Ravi Manager" } } }));
    await screen.findByRole("option", { name: "Ravi Manager" });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Wrong item billed" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: MANAGER_ID } });
    for (const d of ["4", "8", "2", "9"]) fireEvent.click(screen.getByRole("button", { name: d }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel the bill" }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalled());
    expect(writes(fetchMock)).toEqual([
      { path: "/pos/approvals", body: { tillId: TILL_ID, managerId: MANAGER_ID, pin: "4829", action: "cancel_bill", details: bill.number } },
      { path: `/pos/bills/${bill.id}/cancel`, body: { reason: "Wrong item billed", approvalToken: "approval-1" } },
    ]);
  });

  it("does not cancel when the PIN is wrong", async () => {
    const { fetchMock, onCancelled } = setup(() => ({ status: 401, body: { statusCode: 401, message: "Wrong PIN" } }));
    await screen.findByRole("option", { name: "Ravi Manager" });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Wrong item billed" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: MANAGER_ID } });
    fireEvent.change(screen.getByLabelText("Manager’s PIN"), { target: { value: "1357" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the bill" }));
    expect(await screen.findByText("Wrong PIN")).toBeTruthy();
    expect(writes(fetchMock).map((w) => w.path)).toEqual(["/pos/approvals"]);
    expect(onCancelled).not.toHaveBeenCalled();
  });
});

describe("OfferForm", () => {
  function setup() {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["offers.manage"]) }),
      "/catalogue/item-groups": () => ({ status: 200, body: [{ id: GROUP_ID, code: "BISC", name: "Biscuits", parentId: null, hsnCode: null, active: true, isLeaf: true, children: [] }] }),
      "/catalogue/brands": () => ({ status: 200, body: [] }),
      "/customer-groups": () => ({ status: 200, body: [] }),
      "/stock/locations": () => ({ status: 200, body: [] }),
      "POST /pos/offers": (_url, init) => ({ status: 201, body: { id: "o1", ...JSON.parse(String(init?.body)) } }),
    });
    const onSaved = vi.fn();
    render(
      <AuthProvider>
        <OfferForm offer={null} today="2026-10-15" onSaved={onSaved} onCancel={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "PARLE21" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Buy 2 get 1 free biscuits" } });
    fireEvent.change(screen.getByLabelText("Kind of offer"), { target: { value: "free_goods" } });
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "groups" } });
    return { fetchMock, onSaved };
  }

  it("refuses buy N get M free without both quantities", async () => {
    const { fetchMock, onSaved } = setup();
    fireEvent.click(await screen.findByLabelText("Biscuits"));
    fireEvent.change(screen.getByLabelText("Buy (quantity)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
    expect(await screen.findByText('Give "buy" and "free" quantities')).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends buy 2 get 1 free on a group, without a value", async () => {
    const { fetchMock, onSaved } = setup();
    fireEvent.click(await screen.findByLabelText("Biscuits"));
    fireEvent.change(screen.getByLabelText("Buy (quantity)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Get free (quantity)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [w] = writes(fetchMock);
    expect(w.path).toBe("/pos/offers");
    expect(w.body).toMatchObject({ code: "PARLE21", kind: "free_goods", appliesTo: "groups", targetIds: [GROUP_ID], buyQuantity: "2", freeQuantity: "1", value: null, startDate: "2026-10-15" });
  });
});
