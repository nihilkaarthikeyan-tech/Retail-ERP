// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 back office: the loyalty screen (tiers, who joins, liability check),
// gift cards (list, detail, block), the customer's points section, the menu
// and the till set-up (points and gift cards are never ticked for a till).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CurrentUser, CustomerLoyaltyDto, GiftCardDto, LoyaltySettingsDto } from "shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CustomerLoyalty } from "@/components/parties/customer-loyalty";
import { TillForm } from "@/components/pos/till-form";
import { AuthProvider } from "@/lib/auth-context";
import { visibleMenu } from "@/lib/menu";
import { StaticModulesProvider } from "@/lib/modules";
import { GiftCardDetail, GiftCardsScreen } from "./gift-card-screens";
import { LoyaltyScreen } from "./loyalty-screen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/loyalty",
}));

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

const person = (permissions: string[], isOwnerAdmin = false): CurrentUser => ({ id: "u1", firstName: "Asha", lastName: null, email: "a@x.in", isOwnerAdmin, permissions: permissions as CurrentUser["permissions"], allStores: true, stores: [], mustChangePassword: false, roles: [] });

type Handler = (body: unknown, url: URL) => { status?: number; body: unknown };

function mockApi(me: CurrentUser, routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/auth/me") return new Response(JSON.stringify(me), { status: 200 });
    const h = routes[`${method} ${url.pathname}`];
    if (!h) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const r = h(init?.body ? JSON.parse(String(init.body)) : undefined, url);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const writes = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") !== "GET").map((c) => ({ method: (c[1] as RequestInit).method, path: new URL(String(c[0])).pathname, body: (c[1] as RequestInit).body ? JSON.parse(String((c[1] as RequestInit).body)) : undefined }));

const SETTINGS: LoyaltySettingsDto = {
  schemeName: "Loyalty points",
  earnSpend: "100.00",
  earnPoints: 1,
  pointValue: "1",
  validityDays: 365,
  minRedeem: 100,
  maxSharePercent: "50",
  joinAll: true,
  customerGroupIds: [],
  expiryTo: "loyalty_expense",
  tiers: [{ id: "t1", name: "Silver", spendFrom: "0.00", earnSpend: "100.00", earnPoints: 1, sortOrder: 0 }],
};

const liability = (ok: boolean) => ({ points: 300, pointValue: "1", value: "300.00", pastExpiry: 0, ledger: ok ? "300.00" : "250.00", pending: "0.00", difference: ok ? "0.00" : "-50.00", ok, topMembers: [{ customerId: "c1", code: "CUS-000002", name: "Meena", points: 300, value: "300.00" }] });

function loyaltyRoutes(ok = true): Record<string, Handler> {
  return {
    "GET /loyalty/settings": () => ({ body: SETTINGS }),
    "GET /customer-groups": () => ({ body: [{ id: "g1", code: "RETAIL", name: "Retail", parentId: null, active: true, isLeaf: true, priceListId: null, paymentTermsId: null, children: [] }] }),
    "GET /loyalty/reports/liability": () => ({ body: liability(ok) }),
    "GET /loyalty/reports/by-month": () => ({ body: [{ month: "2026-10", earned: { points: 460, value: "460.00" }, spent: { points: 0, value: "0.00" }, expired: { points: 160, value: "160.00" }, takenBack: { points: 0, value: "0.00" }, givenBack: { points: 0, value: "0.00" } }] }),
    "GET /loyalty/reports/expiring": () => ({ body: { from: "2026-11-01", to: "2026-11-30", points: 0, value: "0.00", rows: [] } }),
  };
}

function wrap(ui: React.ReactNode, modules: Record<string, boolean> = {}) {
  return render(
    <AuthProvider>
      <StaticModulesProvider modules={modules}>{ui}</StaticModulesProvider>
    </AuthProvider>,
  );
}

describe("menu", () => {
  it("shows Loyalty points and Gift cards only while their modules are on", () => {
    const u = person(["loyalty.view", "giftcards.view"]);
    expect(visibleMenu(u).map((m) => m.href)).toEqual(expect.arrayContaining(["/loyalty", "/gift-cards"]));
    const off = visibleMenu(u, { loyalty: false, gift_cards: false }).map((m) => m.href);
    expect(off).not.toContain("/loyalty");
    expect(off).not.toContain("/gift-cards");
    expect(visibleMenu(person(["pos.sell"])).map((m) => m.href)).not.toContain("/gift-cards");
  });
});

describe("loyalty screen", () => {
  it("shows the scheme and tiers; adding a tier posts its rate and shows the API's message", async () => {
    let fail = true;
    const fn = mockApi(person(["loyalty.manage"]), {
      ...loyaltyRoutes(),
      "POST /loyalty/tiers": () => (fail ? { status: 400, body: { statusCode: 400, message: "Two tiers start at ₹0.00" } } : { body: { ...SETTINGS, tiers: [...SETTINGS.tiers, { id: "t2", name: "Gold", spendFrom: "25000.00", earnSpend: "100.00", earnPoints: 2, sortOrder: 0 }] } }),
    });
    wrap(<LoyaltyScreen />);
    expect(await screen.findByText("Silver")).toBeTruthy();
    expect(screen.getByTestId("scheme-summary").textContent).toMatch(/Points last 365 days/);
    fireEvent.click(screen.getByRole("button", { name: "Add a tier" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gold" } });
    fireEvent.change(screen.getByLabelText("From spend in a year (₹)"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Points earned for that"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Two tiers start at ₹0.00")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Gold")).toBeTruthy();
    expect(writes(fn).at(-1)).toEqual({ method: "POST", path: "/loyalty/tiers", body: { name: "Gold", spendFrom: "25000", earnSpend: "100.00", earnPoints: 2 } });
  });

  it("choosing groups that join saves them", async () => {
    const fn = mockApi(person(["loyalty.manage"]), { ...loyaltyRoutes(), "PATCH /loyalty/settings": (b) => ({ body: { ...SETTINGS, ...(b as object) } }) });
    wrap(<LoyaltyScreen />);
    fireEvent.click(await screen.findByLabelText("Only customers in these groups"));
    fireEvent.click(await screen.findByLabelText("Retail"));
    fireEvent.click(screen.getByRole("button", { name: "Save who joins" }));
    await waitFor(() => expect(writes(fn)).toEqual([{ method: "PATCH", path: "/loyalty/settings", body: { joinAll: false, customerGroupIds: ["g1"] } }]));
  });

  it("without loyalty.manage the tiers cannot be changed", async () => {
    mockApi(person(["loyalty.view"]), loyaltyRoutes());
    wrap(<LoyaltyScreen />);
    expect(await screen.findByText("Silver")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a tier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it.each([
    [true, "Matches the accounts"],
    [false, "Does not match: difference"],
  ])("the points liability says whether it matches the accounts (%s)", async (ok, words) => {
    mockApi(person(["loyalty.manage"]), loyaltyRoutes(ok));
    wrap(<LoyaltyScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: "Reports" }));
    await waitFor(() => expect(screen.getByTestId("points-check").textContent).toContain(words));
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run today's expiry now" })).toBeTruthy();
  });
});

const CARD: GiftCardDto = {
  id: "gc1",
  number: "6123456789012345",
  holderName: "Anita",
  holderPhone: null,
  customerId: null,
  issuedStoreId: "s1",
  issuedOn: "2026-10-21",
  loadedTotal: "1500.00",
  balance: "900.00",
  expiresOn: "2027-10-21",
  status: "active",
  blockedReason: null,
};

describe("gift cards", () => {
  it("lists cards with their balance and total", async () => {
    mockApi(person(["giftcards.view"]), { "GET /gift-cards": () => ({ body: { rows: [{ ...CARD, number: "**** 2345" }], total: 1, page: 1, pageSize: 200, balanceTotal: "900.00" } }) });
    wrap(<GiftCardsScreen />);
    expect(await screen.findByText("**** 2345")).toBeTruthy();
    expect(screen.getByTestId("gc-total").textContent).toMatch(/1 card, holding ₹900.00/);
  });

  it("a manager blocks a card only with a reason; the history is shown", async () => {
    const fn = mockApi(person(["giftcards.manage"]), {
      "GET /gift-cards/gc1": () => ({ body: { ...CARD, entries: [{ id: "e1", kind: "load", amount: "1000.00", balanceAfter: "1000.00", billId: null, billNumber: null, storeId: "s1", entryDate: "2026-10-21", remark: "Receipt GC-2026-27-00001 (Cash)", createdAt: "2026-10-21T05:00:00.000Z" }] } }),
      "POST /gift-cards/gc1/block": (b) => ({ body: { ...CARD, status: "blocked", blockedReason: (b as { reason: string }).reason, entries: [] } }),
    });
    wrap(<GiftCardDetail id="gc1" />);
    expect(await screen.findByText("6123 4567 8901 2345")).toBeTruthy();
    expect(screen.getByText("Loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block the card" }));
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(await screen.findByText(/Say why the card is blocked/)).toBeTruthy();
    expect(writes(fn)).toEqual([]);
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Lost" } });
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(await screen.findByRole("button", { name: "Unblock" })).toBeTruthy();
    expect(writes(fn)).toEqual([{ method: "POST", path: "/gift-cards/gc1/block", body: { reason: "Lost" } }]);
  });

  it("without giftcards.manage there is no block button", async () => {
    mockApi(person(["giftcards.view"]), { "GET /gift-cards/gc1": () => ({ body: { ...CARD, number: "**** 2345", entries: [] } }) });
    wrap(<GiftCardDetail id="gc1" />);
    expect(await screen.findByText("**** 2345")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Block the card" })).toBeNull();
  });
});

const POINTS: CustomerLoyaltyDto = {
  customerId: "c1",
  member: true,
  reason: null,
  balance: 102,
  balanceValue: "102.00",
  available: 102,
  tier: { name: "Gold", earnSpend: "100.00", earnPoints: 2 },
  yearSpend: "27000.00",
  expiringSoon: [{ expiresOn: "2026-11-05", points: 20 }],
  minRedeem: 100,
  maxSharePercent: "50",
  pointValue: "1",
  history: [
    { id: "h1", kind: "earn", points: 150, value: "150.00", billId: "b1", billNumber: "MAT1/2627/000001", entryDate: "2026-10-21", expiresOn: "2027-10-21", remaining: 100, storeId: null },
    { id: "h2", kind: "reverse_earn", points: -2, value: "-2.00", billId: "b2", billNumber: "MAT1/2627/000003", entryDate: "2026-10-21", expiresOn: null, remaining: null, storeId: null },
    { id: "h3", kind: "restore_spend", points: 50, value: "50.00", billId: "b2", billNumber: "MAT1/2627/000003", entryDate: "2026-10-21", expiresOn: null, remaining: null, storeId: null },
  ],
};

describe("customer page: loyalty points", () => {
  it("shows the balance, tier, expiring points and the history in plain words", async () => {
    mockApi(person(["customers.view"]), { "GET /loyalty/customers/c1": () => ({ body: POINTS }) });
    wrap(<CustomerLoyalty customerId="c1" />);
    expect(await screen.findByText("102 points")).toBeTruthy();
    expect(screen.getByText("Gold")).toBeTruthy();
    expect(screen.getByTestId("expiring-soon").textContent).toMatch(/20 on/);
    expect(screen.getByText("Earned")).toBeTruthy();
    expect(screen.getByText("Taken back (return)")).toBeTruthy();
    expect(screen.getByText("Given back (return)")).toBeTruthy();
    expect(screen.getAllByText("MAT1/2627/000003")).toHaveLength(2);
  });

  it("is hidden while the module is off", async () => {
    const fn = mockApi(person(["customers.view"]), { "GET /loyalty/customers/c1": () => ({ body: POINTS }) });
    const { container } = wrap(<CustomerLoyalty customerId="c1" />, { loyalty: false });
    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(fn.mock.calls.some((c) => String(c[0]).includes("/loyalty/"))).toBe(false);
  });
});

describe("till set-up", () => {
  it("never offers the loyalty points and gift card methods for ticking", async () => {
    mockApi(person(["pos.setup"]), {
      "GET /stock/locations": () => ({ body: [{ id: "l1", code: "MAIN-FLOOR", name: "Floor", kind: "shelf", active: true, parentId: null, store: { id: "s1", code: "MAIN", name: "Main" } }] }),
      "GET /price-lists": () => ({ body: [] }),
      "GET /pos/payment-methods": () => ({
        body: [
          { id: "m1", code: "CASH", name: "Cash", kind: "cash", use: "cash", allowRefund: true, needsReference: false, accountRole: "cash_in_till", active: true },
          { id: "m2", code: "POINTS", name: "Loyalty points", kind: "other", use: "points", allowRefund: true, needsReference: false, accountRole: "loyalty_liability", active: true },
          { id: "m3", code: "GIFTCARD", name: "Gift card", kind: "other", use: "gift_card", allowRefund: true, needsReference: false, accountRole: "gift_card_liability", active: true },
        ],
      }),
    });
    wrap(<TillForm till={null} canEdit onSaved={() => {}} />);
    expect(await screen.findByLabelText("Cash")).toBeTruthy();
    expect(screen.queryByLabelText("Loyalty points")).toBeNull();
    expect(screen.queryByLabelText("Gift card")).toBeNull();
  });
});
