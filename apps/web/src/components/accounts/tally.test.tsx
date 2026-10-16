// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { changedRows, monthStart, type TallyMapRow, tallyVouchersPath } from "@/lib/tally";
import { TallyView } from "./tally-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const user = (permissions: string[]) => ({ id: "u1", firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: false, permissions, allStores: false, stores: [{ id: "s1", code: "MAIN", name: "Main Store" }], mustChangePassword: false, roles: [] });

const ROWS: TallyMapRow[] = [
  { accountId: "a1", number: "4110", name: "Sales", kind: "income", active: true, tallyGroup: "Sales Accounts", tallyLedger: "Sales", mapped: false },
  { accountId: "a2", number: "5210", name: "Rent", kind: "expense", active: true, tallyGroup: "Indirect Expenses", tallyLedger: "Shop Rent", mapped: true },
];

type Route = (url: URL, init: RequestInit | undefined) => Response;

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${url.pathname}`] ?? routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    return route(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tally helpers", () => {
  it("builds the export address and the month start", () => {
    expect(tallyVouchersPath("2026-10-01", "2026-10-16", "")).toBe("/tally/vouchers?from=2026-10-01&to=2026-10-16");
    expect(tallyVouchersPath("2026-10-01", "2026-10-16", "s1")).toBe("/tally/vouchers?from=2026-10-01&to=2026-10-16&storeId=s1");
    expect(monthStart("2026-10-16")).toBe("2026-10-01");
  });

  it("sends only names that changed; blank goes back to our own name", () => {
    expect(changedRows(ROWS, { a1: "Sales", a2: "Shop Rent" })).toEqual([]);
    expect(changedRows(ROWS, { a1: " Sales Account " })).toEqual([{ accountId: "a1", tallyLedger: "Sales Account" }]);
    expect(changedRows(ROWS, { a2: "" })).toEqual([{ accountId: "a2", tallyLedger: null }]);
  });
});

describe("Export to Tally screen", () => {
  it("lists each account with its Tally ledger name and saves the changed ones", async () => {
    let sent: unknown = null;
    mockApi({
      "/auth/me": json(user(["tally.export", "accounts.view"])),
      "/tally/ledger-map": json({ rows: ROWS }),
      "PUT /tally/ledger-map": (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ rows: [{ ...ROWS[0], tallyLedger: "Sales Account", mapped: true }, ROWS[1]] }), { status: 200 });
      },
    });
    render(
      <AuthProvider>
        <TallyView />
      </AuthProvider>,
    );
    const sales = (await screen.findByLabelText("Tally ledger for Sales")) as HTMLInputElement;
    expect(sales.value).toBe("Sales");
    expect((screen.getByLabelText("Tally ledger for Rent") as HTMLInputElement).value).toBe("Shop Rent");
    expect(screen.getByText("Sales Accounts")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save ledger names" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(sales, { target: { value: "Sales Account" } });
    expect(screen.getByText("1 change not saved yet")).toBeTruthy();
    fireEvent.click(save);
    expect(await screen.findByText("1 Tally ledger name saved.")).toBeTruthy();
    expect(sent).toEqual({ rows: [{ accountId: "a1", tallyLedger: "Sales Account" }] });
  });

  it("downloads the voucher file for the chosen period and store", async () => {
    const fn = mockApi({
      "/auth/me": json(user(["tally.export"])),
      "/tally/ledger-map": json({ rows: ROWS }),
      "/tally/vouchers": () => new Response("<ENVELOPE/>", { status: 200, headers: { "Content-Disposition": 'attachment; filename="tally-vouchers-2026-10-01-to-2026-10-16.xml"' } }),
    });
    URL.createObjectURL = vi.fn(() => "blob:tally");
    URL.revokeObjectURL = vi.fn();
    let downloaded = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    render(
      <AuthProvider>
        <TallyView />
      </AuthProvider>,
    );
    await screen.findByLabelText("Tally ledger for Sales");
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: "2026-10-16" } });
    fireEvent.change(screen.getByLabelText(/^Store/), { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Download vouchers for Tally" }));
    expect(await screen.findByText(/The voucher file is downloaded/)).toBeTruthy();
    const call = fn.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/tally/vouchers"))!;
    expect(new URL(call).search).toBe("?from=2026-10-01&to=2026-10-16&storeId=s1");
    expect(downloaded).toBe("tally-vouchers-2026-10-01-to-2026-10-16.xml");
  });

  it("refuses a period that ends before it starts, without calling the server", async () => {
    const fn = mockApi({ "/auth/me": json(user(["tally.export"])), "/tally/ledger-map": json({ rows: ROWS }) });
    render(
      <AuthProvider>
        <TallyView />
      </AuthProvider>,
    );
    await screen.findByLabelText("Tally ledger for Sales");
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Download vouchers for Tally" }));
    expect(await screen.findByText("The start date is after the end date.")).toBeTruthy();
    await waitFor(() => expect(fn.mock.calls.some((c) => String(c[0]).includes("/tally/vouchers"))).toBe(false));
  });

  it("without the export right shows the names read-only and no download", async () => {
    mockApi({ "/auth/me": json(user(["accounts.view"])), "/tally/ledger-map": json({ rows: ROWS }) });
    render(
      <AuthProvider>
        <TallyView />
      </AuthProvider>,
    );
    expect(await screen.findByText("Shop Rent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download vouchers for Tally" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save ledger names" })).toBeNull();
  });
});
