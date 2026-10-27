// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12, scenario 12.1: a switched-off module's menus, item-form parts and
// reports are hidden; a company with no saved choice (or while loading) sees everything.
import { cleanup, render, screen } from "@testing-library/react";
import type { CurrentUser } from "shared";
import { MODULE_KEYS, modulesForShopType } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppMenu } from "@/components/app-menu";
import { ItemForm } from "@/components/items/item-form";
import { MENU, visibleMenu } from "@/lib/menu";
import { fullModuleMap, StaticModulesProvider } from "@/lib/modules";
import { reportEntry, reportQuestion, visibleReports } from "@/lib/reports";
import { openEveryMenuGroup } from "@/lib/menu-test-helpers";

// These tests are about who sees which screen, not about folding (decision L11).
beforeEach(openEveryMenuGroup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/",
}));

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { id: "u1", firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: true, permissions: [], allStores: true, stores: [], mustChangePassword: false, roles: [], ...overrides };
}

const allOff = Object.fromEntries(MODULE_KEYS.map((k) => [k, false]));
const FANCY = modulesForShopType("fancy");

afterEach(cleanup);

describe("menu and modules", () => {
  it("every module-only entry names a real module", () => {
    for (const e of MENU) if (e.module) expect(MODULE_KEYS).toContain(e.module);
    expect(MENU.filter((e) => e.module).length).toBeGreaterThanOrEqual(16);
  });

  it("without a map, or with every module on, the owner sees every module page", () => {
    const hrefs = visibleMenu(user()).map((e) => e.href);
    expect(visibleMenu(user(), fullModuleMap({})).map((e) => e.href)).toEqual(hrefs);
    for (const href of ["/catalogue/attributes", "/catalogue/seasons", "/stock/batches", "/orders", "/alterations", "/purchases/consignment", "/gst/e-invoices", "/settings/modules"]) expect(hrefs).toContain(href);
  });

  it("a fancy shop does not see sizes, batches, seasons, alterations or sale-or-return in the menu", () => {
    render(
      <StaticModulesProvider modules={FANCY}>
        <AppMenu user={user()} pathname="/" />
      </StaticModulesProvider>,
    );
    for (const label of ["Attributes", "Seasons", "Markdowns", "Batches", "Alterations", "Sale or return", "Customer orders", "Sales staff", "Expenses", "Export to Tally", "E-invoices", "E-way bills"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    // Its own modules and the core stay.
    for (const label of ["Items", "Offers and coupons", "Home deliveries", "In transit", "Purchase orders", "Open the till", "My modules"]) expect(screen.getByRole("link", { name: label })).toBeTruthy();
  });

  it("with everything off only the core remains; a missing key counts as on", () => {
    const hrefs = visibleMenu(user(), allOff).map((e) => e.href);
    expect(hrefs.some((h) => MENU.find((e) => e.href === h)?.module)).toBe(false);
    expect(hrefs).toContain("/items");
    expect(visibleMenu(user(), { variants: false }).map((e) => e.href)).toContain("/catalogue/seasons");
  });

  it('"My modules" is for the Owner only', () => {
    expect(visibleMenu(user({ isOwnerAdmin: false, permissions: ["catalogue.view"] })).map((e) => e.href)).not.toContain("/settings/modules");
  });
});

describe("item form", () => {
  const props = { item: null, groups: [], brands: [], units: [], attributes: [], settings: null, seasons: [], onSaved: () => {} };

  it("shows styles, season, batches and serial numbers while their modules are on", () => {
    render(
      <StaticModulesProvider modules={{}}>
        <ItemForm {...props} />
      </StaticModulesProvider>,
    );
    expect(screen.getByLabelText(/This is a style with variants/)).toBeTruthy();
    expect(screen.getByLabelText("Season")).toBeTruthy();
    expect(screen.getByLabelText(/Track batches/)).toBeTruthy();
    expect(screen.getByLabelText("Shelf life (days)")).toBeTruthy();
    expect(screen.getByLabelText(/Track serial numbers/)).toBeTruthy();
    expect(screen.getByLabelText("Warranty (days)")).toBeTruthy();
  });

  it("a fancy shop's item form has none of them, but keeps the first selling price", () => {
    render(
      <StaticModulesProvider modules={FANCY}>
        <ItemForm {...props} />
      </StaticModulesProvider>,
    );
    expect(screen.queryByLabelText(/This is a style with variants/)).toBeNull();
    expect(screen.queryByLabelText("Season")).toBeNull();
    expect(screen.queryByLabelText(/Track batches/)).toBeNull();
    expect(screen.queryByLabelText("Shelf life (days)")).toBeNull();
    expect(screen.queryByLabelText(/Track serial numbers/)).toBeNull();
    expect(screen.queryByLabelText("Warranty (days)")).toBeNull();
    expect(screen.queryByText("Tracking")).toBeNull();
    expect(screen.getByLabelText("First selling price")).toBeTruthy();
  });

  it("a cosmetics shop tracks batches but not serial numbers", () => {
    render(
      <StaticModulesProvider modules={modulesForShopType("cosmetics")}>
        <ItemForm {...props} />
      </StaticModulesProvider>,
    );
    expect(screen.getByLabelText(/Track batches/)).toBeTruthy();
    expect(screen.queryByLabelText(/Track serial numbers/)).toBeNull();
  });
});

describe("report centre", () => {
  const reporter = user({ isOwnerAdmin: false, permissions: ["pos.reports", "stock.view", "purchase.view", "accounts.view", "tally.export"] });

  it("leaves out reports of switched-off modules", () => {
    const all = visibleReports(reporter).map((r) => r.id);
    for (const id of ["season-sell-through", "batches", "till-salesperson", "in-transit", "order-follow-up", "cash-book", "bank-book", "tally-export"]) expect(all).toContain(id);
    const fancy = visibleReports(reporter, FANCY).map((r) => r.id);
    for (const id of ["season-sell-through", "batches", "till-salesperson", "cash-book", "tally-export"]) expect(fancy).not.toContain(id);
    for (const id of ["in-transit", "order-follow-up", "daily-sales", "item-sales"]) expect(fancy).toContain(id);
  });

  it("the item-wise sales question names styles, sizes, colours and seasons only when they are on", () => {
    const entry = reportEntry("item-sales");
    expect(reportQuestion(entry)).toMatch(/style, size, colour, season/);
    expect(reportQuestion(entry, FANCY)).toBe("What sold, by item, group or brand, with quantity and value.");
  });
});
