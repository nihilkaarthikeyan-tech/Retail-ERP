// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12, scenario 12.8 on screen: every setting with its label, explanation
// and default; "Back to default" through the module's own settings API;
// settings of switched-off modules hidden; search by name.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type CurrentUser, type ModuleKey, SETTINGS, SETTINGS_SOURCES, type SettingsSourceKey } from "shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { StaticModulesProvider } from "@/lib/modules";
import { SettingsCentre } from "./settings-centre";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/settings",
}));

const person = (isOwnerAdmin: boolean, permissions: string[] = []): CurrentUser => ({ id: "u1", firstName: "Karthik", lastName: null, email: "owner@example.com", isOwnerAdmin, permissions: permissions as CurrentUser["permissions"], allStores: true, stores: [], mustChangePassword: false, roles: [] });

const LISTS: Record<string, unknown[]> = {
  "/price-lists": [
    { id: "pl-sell", code: "STD-SELL", name: "Standard Selling", forSelling: true, forBuying: false, active: true },
    { id: "pl-buy", code: "STD-BUY", name: "Standard Buying", forSelling: false, forBuying: true, active: true },
    { id: "pl-whole", code: "WHOLE", name: "Wholesale", forSelling: true, forBuying: false, active: true },
  ],
  "/catalogue/units": [{ id: "u-pcs", code: "PCS", name: "Pieces", active: true }],
  "/catalogue/item-groups": [{ id: "g-gift", code: "GIFT", name: "Gift articles", active: true, isLeaf: true, children: [] }],
  "/customer-groups": [{ id: "cg-retail", code: "RETAIL", name: "Retail", active: true, isLeaf: true, children: [] }],
  "/supplier-groups": [{ id: "sg-local", code: "LOCAL", name: "Local suppliers", active: true, isLeaf: true, children: [] }],
  "/payment-terms": [{ id: "pt-cash", code: "CASH", name: "Cash", active: true }],
};
const DEFAULT_IDS: Record<string, string> = { "STD-SELL": "pl-sell", "STD-BUY": "pl-buy", PCS: "u-pcs", RETAIL: "cg-retail", LOCAL: "sg-local", CASH: "pt-cash" };

/** Every settings API answering with the defaults, as a new company's would. */
function defaults(): Record<SettingsSourceKey, Record<string, unknown>> {
  const out = Object.fromEntries(Object.keys(SETTINGS_SOURCES).map((k) => [k, {} as Record<string, unknown>])) as Record<SettingsSourceKey, Record<string, unknown>>;
  for (const s of SETTINGS) out[s.source][s.field] = s.kind === "reference" && s.lookup?.defaultCode ? DEFAULT_IDS[s.lookup.defaultCode] : s.default;
  out.summaryEmail.figures = ["sales", "payments"];
  return out;
}

function mockApi(me: CurrentUser, values = defaults()) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/auth/me") return reply(me);
    if (method === "GET" && LISTS[url.pathname]) return reply(LISTS[url.pathname]);
    for (const [key, src] of Object.entries(SETTINGS_SOURCES) as [SettingsSourceKey, (typeof SETTINGS_SOURCES)[SettingsSourceKey]][]) {
      if (method === "GET" && url.pathname === src.get) return reply(values[key]);
      if (src.save && method === src.save.method && url.pathname === src.save.path) {
        values[key] = { ...values[key], ...JSON.parse(String(init!.body)) };
        return reply(values[key]);
      }
    }
    return reply({ message: `No route for ${method} ${url.pathname}` }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, values };
}

const writes = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") !== "GET").map((c) => ({ method: (c[1] as RequestInit).method, path: new URL(String(c[0])).pathname, body: JSON.parse(String((c[1] as RequestInit).body)) }));

function renderCentre(modules: Partial<Record<ModuleKey, boolean>> = {}) {
  return render(
    <AuthProvider>
      <StaticModulesProvider modules={modules} shopType="fancy">
        <SettingsCentre />
      </StaticModulesProvider>
    </AuthProvider>,
  );
}

/** The row of one setting, found by its label. */
const row = (label: string) => screen.getByText(label, { selector: ".settings-label" }).closest("li") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings centre (12.8)", () => {
  it("shows every setting with a plain label, its explanation and its default", async () => {
    mockApi(person(true));
    renderCentre();
    expect(await screen.findByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    await waitFor(() => expect(within(row("Receipt copies")).getByLabelText("Receipt copies")).toBeTruthy());
    const r = row("Approval limit (₹)");
    expect(within(r).getByText("Orders above this total need a Store Manager or the Owner to finalise.")).toBeTruthy();
    expect(within(r).getByText(/Default: ₹50,000/)).toBeTruthy();
    expect(within(r).getByText("At default")).toBeTruthy();
    expect(within(row("Default selling price list")).getByRole("combobox")).toBeTruthy();
    await waitFor(() => expect((within(row("Default selling price list")).getByRole("combobox") as HTMLSelectElement).value).toBe("pl-sell"));
    expect(screen.getByText("Fancy and gift: Fashion jewellery, cosmetics, toys, bags, gifts, stationery and decor.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /My modules/ }).getAttribute("href")).toBe("/settings/modules");
    // The older screen stays reachable from here.
    expect(screen.getAllByRole("link", { name: "GST settings and the accountant’s approval" })[0].getAttribute("href")).toBe("/gst/settings");
  });

  it("“Back to default” puts a setting back through its own module’s settings API", async () => {
    const start = defaults();
    start.purchase.approvalLimit = "75000.00";
    start.print.paperSize = "A5";
    start.catalogue.defaultSellingPriceListId = "pl-whole";
    const { fn } = mockApi(person(true), start);
    renderCentre();

    const limit = await waitFor(() => row("Approval limit (₹)"));
    await waitFor(() => expect(within(limit).queryByText("At default")).toBeNull());
    fireEvent.click(within(limit).getByRole("button", { name: "Back to default: Approval limit (₹)" }));
    await waitFor(() => expect(within(row("Approval limit (₹)")).getByText("At default")).toBeTruthy());

    fireEvent.click(within(row("Paper size")).getByRole("button", { name: /Back to default/ }));
    await waitFor(() => expect(within(row("Paper size")).getByText("At default")).toBeTruthy());

    await waitFor(() => expect((within(row("Default selling price list")).getByRole("combobox") as HTMLSelectElement).value).toBe("pl-whole"));
    fireEvent.click(within(row("Default selling price list")).getByRole("button", { name: /Back to default/ }));
    await waitFor(() => expect((within(row("Default selling price list")).getByRole("combobox") as HTMLSelectElement).value).toBe("pl-sell"));

    expect(writes(fn)).toEqual([
      { method: "PATCH", path: "/purchase/settings", body: { approvalLimit: "50000" } },
      // A whole-object API gets the other values unchanged.
      { method: "PUT", path: "/print/settings", body: { paperSize: "A4", showLogo: true, storeLetterhead: true } },
      { method: "PATCH", path: "/catalogue/settings", body: { defaultSellingPriceListId: "pl-sell" } },
    ]);
  });

  it("a switch saves at once, sending only that setting", async () => {
    const { fn } = mockApi(person(true));
    renderCentre();
    const sw = await waitFor(() => within(row("Block selling below cost")).getByRole("checkbox"));
    fireEvent.click(sw);
    await waitFor(() => expect(within(row("Block selling below cost")).getByText("Saved")).toBeTruthy());
    expect(writes(fn)).toEqual([{ method: "PATCH", path: "/catalogue/settings", body: { blockSellingBelowCost: true } }]);
  });

  it("hides the settings of switched-off modules", async () => {
    mockApi(person(true));
    renderCentre({ batches: false, purchase_orders: false, eway: false });
    await screen.findByText("Receipt copies", { selector: ".settings-label" });
    for (const label of ["Batch the till sells first", "Approval limit (₹)", "E-way bill needed above (₹)"]) expect(screen.queryByText(label, { selector: ".settings-label" })).toBeNull();
    for (const title of ["Batches and expiry", "Purchase orders", "E-way bill"]) expect(screen.queryByRole("heading", { name: title })).toBeNull();
    expect(screen.getByRole("heading", { name: "Suppliers and buying" })).toBeTruthy();
    cleanup();

    mockApi(person(true));
    renderCentre({});
    expect(await screen.findByText("Batch the till sells first", { selector: ".settings-label" })).toBeTruthy();
  });

  it("search finds a setting by name", async () => {
    mockApi(person(true));
    renderCentre();
    await screen.findByText("Paper size", { selector: ".settings-label" });
    fireEvent.change(screen.getByLabelText("Find a setting"), { target: { value: "receipt" } });
    expect(screen.getByText("Receipt copies", { selector: ".settings-label" })).toBeTruthy();
    expect(screen.getByText("GST table on till receipts", { selector: ".settings-label" })).toBeTruthy();
    expect(screen.queryByText("Number items automatically", { selector: ".settings-label" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/settings found/);

    fireEvent.change(screen.getByLabelText("Find a setting"), { target: { value: "credit limit" } });
    expect(screen.getByText("Default credit limit (₹)", { selector: ".settings-label" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a setting"), { target: { value: "zebra crossing" } });
    expect(screen.getByText("No setting matches that.")).toBeTruthy();
  });

  it("someone who may only look sees the values but cannot change them", async () => {
    const { fn } = mockApi(person(false, ["pos.sell", "purchase.view"]));
    renderCentre();
    expect(await within(await waitFor(() => row("Receipt copies"))).findByText("1")).toBeTruthy();
    expect(within(row("Receipt copies")).queryByRole("combobox")).toBeNull();
    expect(within(row("Approval limit (₹)")).queryByRole("button", { name: /Back to default/ })).toBeNull();
    // Settings this person may not read are not shown at all.
    expect(screen.queryByText("Paper size", { selector: ".settings-label" })).toBeNull();
    expect(screen.queryByText("Shortest password", { selector: ".settings-label" })).toBeNull();
    expect(screen.queryByRole("link", { name: /My modules/ })).toBeNull();
    expect(fn.mock.calls.some((c) => new URL(String(c[0])).pathname === "/settings/security")).toBe(false);
  });
});
