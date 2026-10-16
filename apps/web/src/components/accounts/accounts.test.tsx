// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type AccountDto, journalTotals, previewOldestFirst, type OpenItemDto } from "@/lib/accounts";
import { AuthProvider } from "@/lib/auth-context";
import { ChartOfAccounts } from "./chart-of-accounts";
import { JournalForm } from "./journal-form";
import { LedgerEntryButton } from "./ledger-entry";
import { PaymentForm } from "./payment-form";
import { Decimal } from "shared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

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

const ID = {
  assets: "a0000000-0000-4000-8000-000000000001",
  cashGroup: "a0000000-0000-4000-8000-000000000002",
  cash: "a0000000-0000-4000-8000-000000000003",
  bank: "a0000000-0000-4000-8000-000000000004",
  receivable: "a0000000-0000-4000-8000-000000000005",
  liabilities: "a0000000-0000-4000-8000-000000000006",
  payable: "a0000000-0000-4000-8000-000000000007",
  income: "a0000000-0000-4000-8000-000000000008",
  sales: "a0000000-0000-4000-8000-000000000009",
  expenses: "a0000000-0000-4000-8000-00000000000a",
  rent: "a0000000-0000-4000-8000-00000000000b",
};
const SUPPLIER = "b0000000-0000-4000-8000-000000000001";

function acc(over: Partial<AccountDto> & Pick<AccountDto, "id" | "name" | "family">): AccountDto {
  return { parentId: null, number: null, isGroup: false, kind: null, storeId: null, balanceMustBe: null, locked: false, active: true, systemKey: null, balance: "0.00", debitMinusCredit: "0.00", usedFor: [], ...over };
}

const ACCOUNTS: AccountDto[] = [
  acc({ id: ID.assets, number: "1000", name: "Assets", family: "asset", isGroup: true, balance: "1120.00" }),
  acc({ id: ID.cashGroup, parentId: ID.assets, number: "1110", name: "Cash in hand", family: "asset", isGroup: true, balance: "120.00" }),
  acc({ id: ID.cash, parentId: ID.cashGroup, name: "Cash in hand — MAIN", family: "asset", kind: "cash", balance: "120.00" }),
  acc({ id: ID.bank, parentId: ID.assets, number: "1121", name: "HDFC current account", family: "asset", kind: "bank", balance: "1000.00" }),
  acc({ id: ID.receivable, parentId: ID.assets, number: "1130", name: "Customer balances", family: "asset", kind: "receivable", usedFor: ["customer_receivable"] }),
  acc({ id: ID.liabilities, number: "2000", name: "Liabilities", family: "liability", isGroup: true }),
  acc({ id: ID.payable, parentId: ID.liabilities, number: "2110", name: "Supplier balances", family: "liability", kind: "payable", usedFor: ["supplier_payable"] }),
  acc({ id: ID.income, number: "4000", name: "Income", family: "income", isGroup: true, balance: "122.85" }),
  acc({ id: ID.sales, parentId: ID.income, number: "4110", name: "Sales", family: "income", kind: "income", balance: "122.85", usedFor: ["sales"] }),
  acc({ id: ID.expenses, number: "5000", name: "Expenses", family: "expense", isGroup: true }),
  acc({ id: ID.rent, parentId: ID.expenses, number: "5210", name: "Rent", family: "expense", kind: "expense", locked: true }),
];

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by method and path ("POST /accounts/approve-chart") or path alone. */
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

const ok = (body: unknown) => () => ({ status: 200, body });

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

describe("journal totals (lib)", () => {
  it("adds money with Decimal, never floating point", () => {
    const t = journalTotals([
      { debit: "0.10", credit: "" },
      { debit: "0.20", credit: "" },
      { debit: "", credit: "0.30" },
    ]);
    expect(t.debit.toFixed(2)).toBe("0.30");
    expect(t.difference.isZero()).toBe(true);
    expect(t.balanced).toBe(true);
    // Anything that is not a plain number counts as zero.
    expect(journalTotals([{ debit: "12abc", credit: "" }]).debit.isZero()).toBe(true);
  });
});

describe("JournalForm", () => {
  function setup() {
    mockApi({
      "/auth/me": ok(user(["journals.post", "accounts.view", "stores.view"])),
      "/accounts": ok({ approval: null, accounts: ACCOUNTS }),
      "/stores": ok([]),
    });
    render(
      <AuthProvider>
        <JournalForm journal={null} onSaved={vi.fn()} accounts={ACCOUNTS} />
      </AuthProvider>,
    );
  }

  it("shows live totals and the difference, and keeps Post disabled until it balances", async () => {
    setup();
    await screen.findByRole("heading", { name: "New journal" });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.change(screen.getByLabelText("Account, line 1"), { target: { value: ID.rent } });
    fireEvent.change(screen.getByLabelText("Debit, line 1"), { target: { value: "0.10" } });
    fireEvent.change(screen.getByLabelText("Account, line 2"), { target: { value: ID.rent } });
    fireEvent.change(screen.getByLabelText("Debit, line 2"), { target: { value: "0.20" } });

    expect(screen.getByLabelText("Total debits").textContent).toBe("₹0.30");
    expect(screen.getByLabelText("Total credits").textContent).toBe("₹0.00");
    expect(screen.getByLabelText("Difference").textContent).toContain("₹0.30");
    expect(screen.getByLabelText("Difference").textContent).toContain("credits are short");
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);

    // 0.1 + 0.2 must equal 0.3 exactly.
    fireEvent.change(screen.getByLabelText("Account, line 3"), { target: { value: ID.cash } });
    fireEvent.change(screen.getByLabelText("Credit, line 3"), { target: { value: "0.30" } });
    expect(screen.getByLabelText("Total credits").textContent).toBe("₹0.30");
    expect(screen.queryByLabelText("Difference")).toBeNull();
    expect(screen.getByText("Balanced")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(false);

    // Typing a credit clears the debit on the same line.
    fireEvent.change(screen.getByLabelText("Credit, line 1"), { target: { value: "5" } });
    expect((screen.getByLabelText("Debit, line 1") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds the difference to the chosen account with “Balance against…”", async () => {
    setup();
    await screen.findByRole("heading", { name: "New journal" });
    fireEvent.change(screen.getByLabelText("Account, line 1"), { target: { value: ID.rent } });
    fireEvent.change(screen.getByLabelText("Debit, line 1"), { target: { value: "1250.50" } });
    const add = screen.getByRole("button", { name: "Add the difference" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Balance against/), { target: { value: ID.cash } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    // The empty second line is dropped and the balancing credit is added.
    expect((screen.getByLabelText("Account, line 2") as HTMLSelectElement).value).toBe(ID.cash);
    expect((screen.getByLabelText("Credit, line 2") as HTMLInputElement).value).toBe("1250.50");
    expect(screen.queryByLabelText("Account, line 3")).toBeNull();
    expect(screen.getByText("Balanced")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers store managers only petty-cash journals and no customer or supplier accounts", async () => {
    mockApi({
      "/auth/me": ok({ ...user(["cash.deposit", "accounts.view"]), allStores: false, stores: [{ id: "s1", code: "MAIN", name: "Main Store" }] }),
      "/accounts": ok({ approval: null, accounts: ACCOUNTS }),
    });
    render(
      <AuthProvider>
        <JournalForm journal={null} onSaved={vi.fn()} accounts={ACCOUNTS} />
      </AuthProvider>,
    );
    await waitFor(() => expect((screen.getByLabelText("What is it for") as HTMLSelectElement).disabled).toBe(true));
    const kinds = within(screen.getByLabelText("What is it for")).getAllByRole("option");
    expect(kinds.map((o) => o.textContent)).toEqual(["Petty cash (cash spent or received)"]);
    const accounts = within(screen.getByLabelText("Account, line 1")).getAllByRole("option").map((o) => o.textContent);
    expect(accounts).not.toContain("1130 Customer balances");
    expect(accounts).not.toContain("2110 Supplier balances");
    expect(accounts).toContain("5210 Rent (locked)");
  });
});

describe("Payment form: settling oldest first", () => {
  const bill = (id: string, number: string, date: string, dueDate: string | null, owed: string): OpenItemDto => ({ itemType: "supplier_bill", itemId: id, number, date, dueDate, amount: owed, settled: "0.00", owed });
  const ITEMS: OpenItemDto[] = [
    bill("c0000000-0000-4000-8000-000000000002", "PB-2", "2026-09-10", "2026-10-10", "700.00"),
    bill("c0000000-0000-4000-8000-000000000001", "PB-1", "2026-08-01", "2026-08-31", "1000.00"),
    bill("c0000000-0000-4000-8000-000000000003", "PB-3", "2026-10-01", "2026-10-31", "400.00"),
    { itemType: "payment", itemId: "c0000000-0000-4000-8000-000000000009", number: "PAY-1", date: "2026-07-01", dueDate: null, amount: "-50.00", settled: "0.00", owed: "-50.00" },
  ];

  it("previews by due date, the same rule as the API", () => {
    const p = previewOldestFirst(new Decimal("1500"), ITEMS);
    expect(p.rows.map((r) => [r.item.number, r.amount.toFixed(2)])).toEqual([
      ["PB-1", "1000.00"],
      ["PB-2", "500.00"],
      ["PB-3", "0.00"],
    ]);
    expect(p.leftOver.toFixed(2)).toBe("0.00");
  });

  it("shows what each unpaid bill gets and the advance left over", async () => {
    mockApi({
      "/auth/me": ok(user(["payments.post", "accounts.view", "stores.view"])),
      "/accounts": ok({ approval: null, accounts: ACCOUNTS }),
      "/bank-accounts": ok([]),
      "/stores": ok([]),
      "/suppliers": ok({ rows: [{ id: SUPPLIER, code: "SUP-000001", name: "Metro Distributors", mobile: null }] }),
      [`/parties/supplier/${SUPPLIER}/open-items`]: ok(ITEMS),
    });
    render(
      <AuthProvider>
        <PaymentForm payment={null} onSaved={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByLabelText("Money paid to a supplier"));
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Metro" } });
    fireEvent.click(await screen.findByRole("button", { name: /Metro Distributors/ }));
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1500" } });

    expect((await screen.findByLabelText("Settles on PB-1")).textContent).toBe("₹1,000.00");
    expect(screen.getByLabelText("Settles on PB-2").textContent).toBe("₹500.00");
    expect(screen.getByLabelText("Settles on PB-3").textContent).toBe("—");
    // Bills are listed oldest due date first.
    const rows = within(screen.getByRole("table", { name: "Unpaid bills" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.match(/PB-\d/)?.[0])).toEqual(["PB-1", "PB-2", "PB-3"]);
    const summary = screen.getByLabelText("Settlement summary");
    expect(summary.textContent).toContain("₹1,500.00");

    // More than all the bills: the rest stays as an advance.
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2500" } });
    expect(screen.getByLabelText("Settles on PB-3").textContent).toBe("₹400.00");
    expect(within(summary).getByText("₹400.00")).toBeTruthy();
    expect(screen.getByText(/Unused from earlier: ₹50.00/)).toBeTruthy();
    // Money comes only from cash or bank accounts in the chart.
    expect(within(screen.getByLabelText(/^Money comes from/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an account", "Cash in hand — MAIN", "1121 HDFC current account"]);
  });
});

describe("ChartOfAccounts", () => {
  it("shows the tree with balances and the approval banner, and records the CA's approval", async () => {
    let approved = false;
    const fetchMock = mockApi({
      "/auth/me": ok(user(["accounts.view", "accounts.approve_chart"])),
      "/accounts": () => ({ status: 200, body: { approval: approved ? { approvedAt: "2026-10-15T06:00:00.000Z", approvedById: "u1", note: "Approved by R. Iyer, CA" } : null, accounts: ACCOUNTS } }),
      "POST /accounts/approve-chart": () => {
        approved = true;
        return { status: 200, body: {} };
      },
    });
    render(
      <AuthProvider>
        <ChartOfAccounts />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Proposed chart, waiting for the Chartered Accountant/)).toBeTruthy();
    expect(screen.getByText("4110 Sales")).toBeTruthy();
    expect(screen.getByLabelText("Balance of Sales").textContent).toBe("₹122.85");
    expect(screen.getByLabelText("Balance of Assets").textContent).toBe("₹1,120.00");
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getByText("Used for: Sales")).toBeTruthy();
    // Without accounts.manage there is nothing to change.
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Record the CA's approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: "Approved by R. Iyer, CA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record approval" }));
    await waitFor(() => expect(writes(fetchMock)).toEqual([{ path: "/accounts/approve-chart", body: { note: "Approved by R. Iyer, CA" } }]));
    await waitFor(() => expect(screen.queryByText(/Proposed chart/)).toBeNull());
    expect(screen.getByText(/Approved by the Chartered Accountant, recorded on 15 Oct 2026: Approved by R. Iyer, CA/)).toBeTruthy();
  });

  it("offers add, change and switch off to managers but no approval without the right", async () => {
    mockApi({
      "/auth/me": ok(user(["accounts.view", "accounts.manage"])),
      "/accounts": ok({ approval: null, accounts: ACCOUNTS }),
    });
    render(
      <AuthProvider>
        <ChartOfAccounts />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Proposed chart/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Add account" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Record the CA's approval" })).toBeNull();
    // Top-level folders cannot be changed or switched off; the books.lock right is needed to lock.
    expect(screen.getAllByRole("button", { name: "Change" }).length).toBe(ACCOUNTS.filter((a) => a.parentId).length);
    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
  });
});

describe("LedgerEntryButton", () => {
  it("is hidden without accounts.view and shows the entry's lines with it", async () => {
    mockApi({
      "/auth/me": ok(user(["accounts.view"])),
      "/ledger/entries": (url) => ({
        status: 200,
        body:
          url.searchParams.get("documentType") === "supplier_bill"
            ? [{ id: "e1", date: "2026-10-15", documentNumber: "PB-2026-27-00001", remark: null, cancels: null, lines: [{ account: "2120 Goods received not billed", party: null, store: "MAIN", debit: "4750.00", credit: "0.00", remark: null }, { account: "2110 Supplier balances", party: "Metro Distributors", store: "MAIN", debit: "0.00", credit: "4750.00", remark: null }] }]
            : [],
      }),
    });
    render(
      <AuthProvider>
        <LedgerEntryButton documentType="supplier_bill" documentId="d0000000-0000-4000-8000-000000000001" />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "View ledger entry" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("2110 Supplier balances")).toBeTruthy();
    expect(within(dialog).getByText("Metro Distributors")).toBeTruthy();
    expect(within(dialog).getAllByText("₹4,750.00").length).toBe(4);
    cleanup();

    const second = mockApi({ "/auth/me": ok(user(["purchase.view"])) });
    render(
      <AuthProvider>
        <LedgerEntryButton documentType="supplier_bill" documentId="d0000000-0000-4000-8000-000000000001" />
      </AuthProvider>,
    );
    await waitFor(() => expect(second).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "View ledger entry" })).toBeNull();
  });
});
