// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CurrentUser, Decimal, type PermissionKey } from "shared";
import { actionLabel, ExportDetails } from "@/components/audit-table";
import { AuthProvider } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { isActive, MENU, visibleMenu } from "@/lib/menu";
import { changeParts, compactValue, type DailySalesDto, niceScale, tidyHint, visibleReports } from "@/lib/reports";
import { BarChart, ColumnChart, LineChart } from "./charts";
import { Dashboards } from "./dashboards";
import { DailySalesReport } from "./sales-reports";
import { SummaryEmailSettings } from "./summary-email";
import { StatTile } from "./tiles";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/reports/daily-sales",
}));

const user = (permissions: PermissionKey[], isOwnerAdmin = false): CurrentUser => ({
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

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by "METHOD /path" or by path alone (any method). */
function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ?? Object.entries(routes).find(([key]) => !key.includes(" ") && url.pathname === key);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown) => () => ({ status: 200, body });

function calls(fn: ReturnType<typeof vi.fn>, method: string, path: string) {
  return fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") === method && c.url.pathname === path);
}

beforeEach(() => {
  search = "";
  replace.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("report helpers (lib)", () => {
  it("shows a change as an arrow-ready percent, or new when there was nothing before", () => {
    expect(changeParts("12.46")).toEqual({ direction: "up", text: "12.5%" });
    expect(changeParts("-100.00")).toEqual({ direction: "down", text: "100%" });
    expect(changeParts("0.00")).toEqual({ direction: "flat", text: "0%" });
    expect(changeParts(null)).toEqual({ direction: "new", text: "new" });
  });

  it("writes short axis labels in Indian units, with Decimal", () => {
    expect(compactValue(new Decimal("950"), "money")).toBe("₹950");
    expect(compactValue(new Decimal("12500"), "money")).toBe("₹12.5K");
    expect(compactValue(new Decimal("120000"), "money")).toBe("₹1.2L");
    expect(compactValue(new Decimal("34000000"), "money")).toBe("₹3.4Cr");
    expect(compactValue(new Decimal("-200"), "money")).toBe("−₹200");
    expect(compactValue(new Decimal("15.34"), "percent")).toBe("15.3%");
  });

  it("rounds the axis to clean steps that include zero", () => {
    const s = niceScale(new Decimal(0), new Decimal("122.85"), "money");
    expect(s.ticks.map((t) => t.toString())).toEqual(["0", "50", "100", "150"]);
    const c = niceScale(new Decimal(0), new Decimal(2), "count");
    expect(c.ticks.every((t) => t.isInteger())).toBe(true);
    const n = niceScale(new Decimal("-220.15"), new Decimal("343"), "money");
    expect(n.lo.lte(new Decimal("-220.15"))).toBe(true);
    expect(n.hi.gte(343)).toBe(true);
  });

  it("tidies amounts and dates in hints", () => {
    expect(tidyHint("₹4940.00 overdue")).toBe("₹4,940.00 overdue");
    expect(tidyHint("Against 2026-09-15 to 2026-09-30")).toBe(`Against ${formatDate("2026-09-15")} to ${formatDate("2026-09-30")}`);
  });

  it("lists only the reports a user may run", () => {
    const cashier = visibleReports(user(["stock.view"]));
    expect(cashier.some((r) => r.id === "stock-cover")).toBe(true);
    expect(cashier.some((r) => r.id === "daily-sales")).toBe(false);
    expect(cashier.some((r) => r.id === "shrinkage")).toBe(false);
    const buyer = visibleReports(user(["purchase.view"]));
    expect(buyer.some((r) => r.id === "order-follow-up")).toBe(true);
    // The purchase register shows buying prices.
    expect(buyer.some((r) => r.id === "purchase-register")).toBe(false);
  });
});

describe("StatTile", () => {
  it("shows the change with an arrow against the previous period", () => {
    const { container } = render(<StatTile tile={{ key: "sales_today", label: "Sales today (before GST)", value: "1250.00", format: "money", previous: "1000.00", changePercent: "25.00" }} />);
    expect(screen.getByText("₹1,250.00")).toBeTruthy();
    expect(container.querySelector(".tile-change > [aria-hidden]")?.textContent).toBe("▲ ");
    expect(screen.getByText("25%")).toBeTruthy();
    expect(container.textContent).toContain("Up 25%");
    expect(container.textContent).toContain("vs previous period (₹1,000.00)");
    expect(container.querySelector(".tile-change-good")).toBeTruthy();
  });

  it("shows a fall as ▼, in the warning colour where a rise is good", () => {
    const { container } = render(<StatTile tile={{ key: "bills_today", label: "Bills today", value: "0", format: "count", previous: "2", changePercent: "-100.00" }} />);
    expect(container.querySelector(".tile-change > [aria-hidden]")?.textContent).toBe("▼ ");
    expect(container.textContent).toContain("Down 100%");
    expect(container.querySelector(".tile-change-bad")).toBeTruthy();
    cleanup();
    // Fewer returns is good news.
    const r = render(<StatTile tile={{ key: "returns_today", label: "Returns today", value: "0.00", format: "money", previous: "59.05", changePercent: "-100.00" }} />);
    expect(r.container.querySelector(".tile-change-good")).toBeTruthy();
  });

  it("says new when there was nothing in the previous period, and nothing when there is no comparison", () => {
    render(<StatTile tile={{ key: "sales_mtd", label: "Sales this month (before GST)", value: "122.85", format: "money", previous: "0.00", changePercent: null, hint: "Against 2026-09-15 to 2026-09-30" }} />);
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.getByText("nothing in the previous period")).toBeTruthy();
    cleanup();
    const { container } = render(<StatTile tile={{ key: "stock_value", label: "Stock value", value: "44516.00", format: "money" }} />);
    expect(screen.getByText("₹44,516.00")).toBeTruthy();
    expect(container.querySelector(".tile-change")).toBeNull();
  });
});

describe("charts", () => {
  it("has a table twin of a bar chart for screen readers, shown on request", () => {
    render(<BarChart title="Top 10 items this week" data={[{ label: "Basmati Rice 1 kg", value: "12" }, { label: "Carry bag", value: "3" }]} kind="quantity" labelHeader="Item" valueHeader="Quantity sold" />);
    const table = screen.getByRole("table", { name: "Top 10 items this week" });
    expect(table.parentElement?.className).toBe("sr-only");
    const rows = within(table).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["ItemQuantity sold", "Basmati Rice 1 kg12", "Carry bag3"]);
    // The drawing itself is hidden from screen readers.
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(table.parentElement?.className).toContain("chart-table");
    expect(screen.getByRole("button", { name: "Show as chart" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("lists every series and the total per period for a stacked chart", () => {
    render(
      <ColumnChart
        title="Sales by store per month"
        data={[
          { label: "2026-09", values: { ANNA: "500.00", MAIN: "1000.00" } },
          { label: "2026-10", values: { MAIN: "122.85" } },
        ]}
        series={[
          { key: "ANNA", label: "ANNA", color: "var(--chart-1)" },
          { key: "MAIN", label: "MAIN", color: "var(--chart-2)" },
        ]}
        kind="money"
        labelHeader="Month"
      />,
    );
    const table = screen.getByRole("table", { name: "Sales by store per month" });
    expect(within(table).getAllByRole("row").map((r) => r.textContent)).toEqual(["MonthANNAMAINTotal", "2026-09₹500.00₹1,000.00₹1,500.00", "2026-10₹0.00₹122.85₹122.85"]);
    // Two series get a legend.
    expect(screen.getByRole("list").textContent).toBe("ANNAMAIN");
  });

  it("says so when there is nothing to draw", () => {
    render(<LineChart title="Sales over the last 30 days" data={[]} kind="money" emptyText="No sales yet." />);
    expect(screen.getAllByText("No sales yet.").length).toBeGreaterThan(0);
    expect(document.querySelector("svg")).toBeNull();
  });
});

const DAILY: DailySalesDto = {
  from: "2026-10-10",
  to: "2026-10-16",
  workedOutAt: "2026-10-16T09:00:00.000Z",
  rows: [
    { date: "2026-10-15", storeId: "s1", store: "MAIN — Main Store", saleBills: 3, returnBills: 1, quantity: "4", grossSales: "1000.00", returns: "-200.00", netSales: "800.00", tax: "40.00", discounts: "0.00", averageBill: "266.67", itemsPerBill: "1.33" },
  ],
  totals: { saleBills: 3, returnBills: 1, quantity: "4", grossSales: "1000.00", returns: "-200.00", netSales: "800.00", tax: "40.00", discounts: "0.00", averageBill: "266.67", itemsPerBill: "1.33" },
};

describe("a report page", () => {
  function setup(exportStatus = 204) {
    const createObjectURL = vi.fn(() => "blob:report");
    // jsdom has no blob URLs.
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetch = mockApi({
      "/auth/me": ok(user(["pos.reports"])),
      "/reports/daily-sales": ok(DAILY),
      "/stores": ok([]),
      "POST /reports/export-log": () => ({ status: exportStatus, body: exportStatus === 204 ? null : { statusCode: 500, message: "Down" } }),
    });
    render(
      <AuthProvider>
        <DailySalesReport />
      </AuthProvider>,
    );
    return { fetch, createObjectURL, click };
  }

  it("shows the totals row, net sales before GST and no cost columns when the API sends none", async () => {
    setup();
    await screen.findByText("MAIN — Main Store");
    expect(screen.getByRole("columnheader", { name: "Net sales (before GST)" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Cost of goods sold" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Margin %" })).toBeNull();
    const totals = document.querySelector(".report-totals");
    expect(totals?.textContent).toContain("Total");
    expect(totals?.textContent).toContain("₹800.00");
    expect(screen.getAllByText(/Worked out at 16 Oct 2026/).length).toBeGreaterThan(0);
  });

  it("records a CSV download in the history", async () => {
    const { fetch, createObjectURL, click } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Download for Excel (CSV)" }));
    await waitFor(() => expect(calls(fetch, "POST", "/reports/export-log")).toHaveLength(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(calls(fetch, "POST", "/reports/export-log")[0].init?.body));
    expect(body.report).toBe("Daily sales by store");
    expect(body.rows).toBe(1);
    expect(body.filters).toMatchObject({ store: "All my stores" });
    expect(body.filters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("still downloads when the history cannot be written", async () => {
    const { createObjectURL } = setup(500);
    fireEvent.click(await screen.findByRole("button", { name: "Download for Excel (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Download for Excel (CSV)" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a changed filter in the address bar", async () => {
    setup();
    await screen.findByText("MAIN — Main Store");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    expect(replace).toHaveBeenCalledWith("/reports/daily-sales?from=2026-10-01", { scroll: false });
  });

  it("uses the dates in the address bar", async () => {
    search = "from=2026-10-01&to=2026-10-05";
    const { fetch } = setup();
    await screen.findByText("MAIN — Main Store");
    const url = calls(fetch, "GET", "/reports/daily-sales")[0].url;
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-05");
  });
});

describe("Dashboards", () => {
  it("shows the dashboards as tabs and remembers the chosen one", async () => {
    mockApi({
      "/auth/me": ok(user(["pos.reports", "accounts.view"])),
      "/stores": ok([]),
      "/dashboards": ok({ dashboards: ["store", "accounts"] }),
      "/dashboards/store": ok({ dashboard: "store", date: "2026-10-16", workedOutAt: "2026-10-16T09:00:00.000Z", tiles: [{ key: "sales_today", label: "Sales today (before GST)", value: "0.00", format: "money", previous: "122.85", changePercent: "-100.00" }], charts: { topItemsThisWeek: [{ label: "Carry bag", value: "1" }] } }),
      "/dashboards/accounts": ok({ dashboard: "accounts", date: "2026-10-16", workedOutAt: "2026-10-16T09:00:00.000Z", tiles: [{ key: "bank", label: "In the bank", value: "5000.00", format: "money" }], charts: { incomeVsExpensesByMonth: [{ month: "2026-10", income: "122.85", expenses: "343.00", net: "-220.15" }] } }),
    });
    render(
      <AuthProvider>
        <Dashboards />
      </AuthProvider>,
    );
    expect(await screen.findByText("Sales today (before GST)")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Top 10 items this week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    expect(await screen.findByText("₹5,000.00")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Income and expenses by month" }).textContent).toContain("₹343.00");
    expect(localStorage.getItem("retail-erp.dashboard-tab")).toBe("accounts");
    expect(screen.getByText(/Worked out at 16 Oct 2026/)).toBeTruthy();
  });

  it("shows nothing to users who may see no dashboard", async () => {
    const fetch = mockApi({ "/auth/me": ok(user(["catalogue.view"])) });
    const { container } = render(
      <AuthProvider>
        <Dashboards />
      </AuthProvider>,
    );
    await waitFor(() => expect(calls(fetch, "GET", "/auth/me")).toHaveLength(1));
    expect(container.textContent).toBe("");
    expect(calls(fetch, "GET", "/dashboards")).toHaveLength(0);
  });
});

describe("SummaryEmailSettings", () => {
  const SETTINGS = {
    enabled: false,
    sendAt: "21:00",
    recipientIds: [],
    figures: ["sales_by_store", "dues"],
    mail: { configured: false, account: "Not set up" },
    figureLabels: { sales_by_store: "Yesterday’s sales per store, against the same day last week", dues: "What customers owe and what the shop owes suppliers, with overdue amounts" },
  };

  function setup(settings = SETTINGS) {
    return mockApi({
      "/auth/me": ok(user([], true)),
      "GET /summary-email/settings": ok(settings),
      "/summary-email/runs": ok([{ id: "r1", businessDate: "2026-10-15", kind: "scheduled", startedAt: "2026-10-15T15:30:00.000Z", sentAt: null, recipients: [], error: "No mail account is set up on the server (SMTP_HOST in .env)" }]),
      "/users": ok([{ id: "a0000000-0000-4000-8000-000000000001", email: "owner@example.com", firstName: "Karthik", lastName: "R", active: true }]),
      "PUT /summary-email/settings": (_url, init) => ok({ ...settings, ...JSON.parse(String(init?.body)) })(),
    });
  }

  it("explains in plain words that the mail account must be added on the server, and still saves", async () => {
    const fetch = setup();
    render(
      <AuthProvider>
        <SummaryEmailSettings />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Email is not set up on the server yet/)).toBeTruthy();
    expect(screen.getByText("SMTP_HOST")).toBeTruthy();
    expect(screen.getByText(/You can still choose and save everything below now/)).toBeTruthy();
    // The last send's error is shown.
    expect(await screen.findByText(/No mail account is set up on the server/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Send the daily summary email/));
    fireEvent.click(await screen.findByLabelText(/Karthik R/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls(fetch, "PUT", "/summary-email/settings")).toHaveLength(1));
    expect(JSON.parse(String(calls(fetch, "PUT", "/summary-email/settings")[0].init?.body))).toEqual({ enabled: true, sendAt: "21:00", recipientIds: ["a0000000-0000-4000-8000-000000000001"], figures: ["sales_by_store", "dues"] });
    expect(await screen.findByText("Saved.")).toBeTruthy();
    // The test send is never made by these checks.
    expect(calls(fetch, "POST", "/summary-email/test")).toHaveLength(0);
  });

  it("asks for someone to send to before switching it on", async () => {
    const fetch = setup();
    render(
      <AuthProvider>
        <SummaryEmailSettings />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByLabelText(/Send the daily summary email/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Choose who receives the email.")).toBeTruthy();
    expect(calls(fetch, "PUT", "/summary-email/settings")).toHaveLength(0);
  });

  it("names the mail account when it is set up", async () => {
    setup({ ...SETTINGS, mail: { configured: true, account: "smtp.example.com as reports@example.com" } });
    render(
      <AuthProvider>
        <SummaryEmailSettings />
      </AuthProvider>,
    );
    expect(await screen.findByText("smtp.example.com as reports@example.com")).toBeTruthy();
    expect(screen.queryByText(/Email is not set up on the server yet/)).toBeNull();
  });
});

describe("menu and history", () => {
  it("adds a Reports section by permission, with the most specific entry active", () => {
    const labels = (permissions: PermissionKey[], owner = false) => visibleMenu(user(permissions, owner)).filter((e) => e.section === "Reports").map((e) => e.label);
    expect(labels(["pos.reports"])).toEqual(["All reports"]);
    expect(labels([])).toEqual([]);
    expect(labels([], true)).toEqual(["All reports", "Daily summary email"]);
    const all = MENU.find((e) => e.href === "/reports")!;
    const email = MENU.find((e) => e.href === "/reports/summary-email")!;
    expect(isActive(all, "/reports/daily-sales")).toBe(true);
    expect(isActive(all, "/reports/summary-email")).toBe(false);
    expect(isActive(email, "/reports/summary-email")).toBe(true);
  });

  it("shows a report download as “Downloaded a report” with its name and filters", () => {
    expect(actionLabel("export")).toBe("Downloaded a report");
    expect(actionLabel("update")).toBe("update");
    render(<ExportDetails changes={{ report: "Daily sales by store", filters: { from: "2026-10-01", to: "2026-10-16", store: "MAIN — Main Store" }, rows: 12 }} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Report: Daily sales by store", `From: ${formatDate("2026-10-01")}`, `To: ${formatDate("2026-10-16")}`, "Store: MAIN — Main Store", "Rows: 12"]);
  });
});
