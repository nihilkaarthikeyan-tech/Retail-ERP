// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type AccountDto, type CashBookDto, type ExpenseOptionsDto, payFromChoices } from "@/lib/accounts";
import { AuthProvider } from "@/lib/auth-context";
import { ExpenseForm } from "./expenses-view";
import { AccountsReports } from "./reports-tabs";

const params = { value: new URLSearchParams("") };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params.value,
}));

const user = (permissions: string[]) => ({ id: "u1", firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: false, permissions, allStores: true, stores: [], mustChangePassword: false, roles: [] });

const ID = {
  main: "c0000000-0000-4000-8000-000000000001",
  anna: "c0000000-0000-4000-8000-000000000002",
  cashMain: "a0000000-0000-4000-8000-000000000001",
  cashAnna: "a0000000-0000-4000-8000-000000000002",
  bank: "a0000000-0000-4000-8000-000000000003",
  rent: "a0000000-0000-4000-8000-000000000004",
  power: "a0000000-0000-4000-8000-000000000005",
  tillMain: "a0000000-0000-4000-8000-000000000006",
};

const ref = (id: string, name: string, kind: "cash" | "bank" | "expense", number: string | null = null, storeId: string | null = null) => ({ id, number, name, kind, storeId, locked: false });

const OPTIONS: ExpenseOptionsDto = {
  stores: [
    { id: ID.main, code: "MAIN", name: "Main Store" },
    { id: ID.anna, code: "ANNA", name: "Anna Nagar" },
  ],
  cashInHand: [
    { storeId: ID.main, account: ref(ID.cashMain, "Cash in hand — MAIN", "cash", null, ID.main) },
    { storeId: ID.anna, account: ref(ID.cashAnna, "Cash in hand — ANNA", "cash", null, ID.anna) },
  ],
  heads: [ref(ID.rent, "Rent", "expense", "5210"), ref(ID.power, "Electricity", "expense", "5230")],
  banks: [ref(ID.bank, "HDFC Current", "bank", "1121")],
};

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

const ok = (body: unknown) => () => ({ status: 200, body });

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
  params.value = new URLSearchParams("");
});

describe("Add expense (plan 11 C8)", () => {
  it("pays from the chosen store's cash in hand or a bank", () => {
    expect(payFromChoices(OPTIONS, ID.anna).map((a) => a.id)).toEqual([ID.cashAnna, ID.bank]);
    expect(payFromChoices(null, ID.anna)).toEqual([]);
  });

  it("sends date, store, head, the store's cash in hand and the amount; the cash follows the store", async () => {
    const fetchMock = mockApi({
      "POST /expenses": (_url, init) => ({ status: 201, body: { id: "e1", number: "EXP-2026-27-00001", amount: JSON.parse(String(init?.body)).amount, expenseAccount: { name: "Rent" } } }),
    });
    const onSaved = vi.fn();
    render(<ExpenseForm options={OPTIONS} today="2026-10-16" onSaved={onSaved} />);
    const payFrom = screen.getByLabelText(/^Paid from/) as HTMLSelectElement;
    expect(payFrom.value).toBe(ID.cashMain);
    fireEvent.change(screen.getByLabelText(/^Store/), { target: { value: ID.anna } });
    expect(payFrom.value).toBe(ID.cashAnna);
    expect(within(payFrom).getAllByRole("option").map((o) => o.textContent)).toEqual(["Cash: Cash in hand — ANNA", "Bank: 1121 HDFC Current"]);

    // Nothing is sent without what the money was spent on.
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByText("Choose what the money was spent on")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Spent on/), { target: { value: ID.rent } });
    fireEvent.change(screen.getByLabelText(/^Remark/), { target: { value: "October rent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ expenseDate: "2026-10-16", storeId: ID.anna, expenseAccountId: ID.rent, paidFromAccountId: ID.cashAnna, amount: "30000", reference: null, remark: "October rent" });
  });

  it("refuses more than two digits of paise before sending, and shows the API's plain message", async () => {
    const fetchMock = mockApi({ "POST /expenses": () => ({ status: 400, body: { statusCode: 400, message: "Cash in hand — MAIN must always have a debit balance; this would make it ₹30000.00 credit" } }) });
    render(<ExpenseForm options={OPTIONS} today="2026-10-16" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Spent on/), { target: { value: ID.rent } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByText("At most two digits after the point (paise)")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByText(/must always have a debit balance/)).toBeTruthy();
  });
});

describe("Cash book (plan 11 C8)", () => {
  const acc = (over: Partial<AccountDto> & Pick<AccountDto, "id" | "name" | "family">): AccountDto => ({ parentId: null, number: null, isGroup: false, kind: null, storeId: null, balanceMustBe: null, locked: false, active: true, systemKey: null, ...over });
  const ACCOUNTS: AccountDto[] = [
    acc({ id: ID.tillMain, name: "Cash in till — MAIN", family: "asset", kind: "cash", storeId: ID.main, systemKey: `cash_in_till:${ID.main}` }),
    acc({ id: ID.cashMain, name: "Cash in hand — MAIN", family: "asset", kind: "cash", storeId: ID.main, systemKey: `cash_in_hand:${ID.main}` }),
    acc({ id: ID.bank, number: "1121", name: "HDFC Current", family: "asset", kind: "bank" }),
    acc({ id: ID.rent, number: "5210", name: "Rent", family: "expense", kind: "expense" }),
  ];
  const BOOK: CashBookDto = {
    book: "cash",
    account: { id: ID.cashMain, number: null, name: "Cash in hand — MAIN", kind: "cash", storeId: ID.main },
    from: "2026-04-01",
    to: "2026-10-16",
    limitedToStores: false,
    opening: "0.00",
    moneyIn: "50000.00",
    moneyOut: "30000.00",
    closing: "20000.00",
    ledgerClosing: "20000.00",
    matchesLedger: true,
    days: [
      { date: "2026-04-01", entries: 1, opening: "0.00", moneyIn: "50000.00", moneyOut: "0.00", closing: "50000.00" },
      { date: "2026-10-16", entries: 1, opening: "50000.00", moneyIn: "0.00", moneyOut: "30000.00", closing: "20000.00" },
    ],
    page: 1,
    pageSize: 500,
    total: 2,
    pageOpening: "0.00",
    rows: [
      { id: "1", date: "2026-04-01", documentType: "journal", documentId: "j1", documentNumber: "JV-2026-27-00001", against: "Temporary opening", store: "MAIN", remark: null, moneyIn: "50000.00", moneyOut: "0.00", balance: "50000.00", cancelled: false },
      { id: "2", date: "2026-10-16", documentType: "journal", documentId: "e1", documentNumber: "EXP-2026-27-00001", against: "Rent", store: "MAIN", remark: "October rent", moneyIn: "0.00", moneyOut: "30000.00", balance: "20000.00", cancelled: false },
    ],
  };

  it("opens on the store's cash in hand and shows days, entries and the ledger check", async () => {
    params.value = new URLSearchParams("tab=cash-book");
    const fetchMock = mockApi({
      "/auth/me": ok(user(["accounts.view"])),
      "/accounts": ok({ approval: null, accounts: ACCOUNTS }),
      "/reports/cash-book": ok(BOOK),
    });
    render(
      <AuthProvider>
        <AccountsReports />
      </AuthProvider>,
    );
    expect(await screen.findByText("Closing balance matches the ledger")).toBeTruthy();
    const asked = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname === "/reports/cash-book")!;
    expect(asked.searchParams.get("accountId")).toBe(ID.cashMain);
    expect((screen.getByLabelText(/^Cash account/) as HTMLSelectElement).value).toBe(ID.cashMain);
    const totals = screen.getByLabelText("Cash book totals");
    expect(totals.textContent).toContain("₹50,000.00");
    expect(totals.textContent).toContain("₹20,000.00");
    const rent = screen.getByText("Rent").closest("tr")!;
    expect(rent.textContent).toContain("EXP-2026-27-00001");
    expect(rent.textContent).toContain("₹30,000.00");
    expect(screen.getByRole("tab", { name: "Bank book" })).toBeTruthy();
  });
});
