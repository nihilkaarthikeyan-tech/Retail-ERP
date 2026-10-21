// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, render, screen } from "@testing-library/react";
import type { CurrentUser } from "shared";
import { afterEach, describe, expect, it } from "vitest";
import { AppMenu } from "./app-menu";

function user(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: "u1",
    firstName: "Ravi",
    lastName: null,
    email: "ravi@example.com",
    isOwnerAdmin: false,
    permissions: [],
    allStores: false,
    stores: [],
    mustChangePassword: false,
    roles: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("AppMenu", () => {
  it("shows every entry to an Owner/Admin", () => {
    render(<AppMenu user={user({ isOwnerAdmin: true })} pathname="/" />);
    for (const label of ["Dashboard", "Company", "Stores", "Financial years", "Document numbering", "Users", "Roles", "Change history", "Login history", "My sessions"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  it("hides entries the user has no permission for", () => {
    render(<AppMenu user={user({ permissions: ["stores.view", "audit.view"] })} pathname="/stores" />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stores" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change history" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "My sessions" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Company" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Roles" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Document numbering" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Financial years" })).toBeNull();
  });

  it("shows only the always-visible entries to a cashier with no rights", () => {
    render(<AppMenu user={user({})} pathname="/" />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "My sessions"]);
  });

  it("marks the current page", () => {
    render(<AppMenu user={user({ permissions: ["stores.view"] })} pathname="/stores/abc" />);
    expect(screen.getByRole("link", { name: "Stores" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the catalogue section only to users with catalogue or price rights", () => {
    render(<AppMenu user={user({ permissions: ["catalogue.view"] })} pathname="/" />);
    expect(screen.getByText("Catalogue")).toBeTruthy();
    for (const label of ["Items", "Item groups", "Brands", "Units", "Attributes", "HSN codes"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: "Price lists" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Prices" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Catalogue settings" })).toBeNull();
    cleanup();

    render(<AppMenu user={user({ permissions: ["prices.view"] })} pathname="/" />);
    expect(screen.getByRole("link", { name: "Price lists" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Prices" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Items" })).toBeNull();
    cleanup();

    render(<AppMenu user={user({})} pathname="/" />);
    expect(screen.queryByText("Catalogue")).toBeNull();
  });

  it("has one Settings entry instead of a settings entry per area (plan 12 §5)", () => {
    render(<AppMenu user={user({ isOwnerAdmin: true })} pathname="/settings" />);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    for (const label of ["Catalogue settings", "Party settings", "Inventory settings", "Purchase settings", "Till settings", "GST settings", "Printing settings"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    cleanup();

    // Anyone who may change some setting sees it; a cashier does not.
    render(<AppMenu user={user({ permissions: ["pos.setup"] })} pathname="/" />);
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    cleanup();
    render(<AppMenu user={user({ permissions: ["pos.sell"] })} pathname="/" />);
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("shows the Parties entries only with the matching rights", () => {
    render(<AppMenu user={user({ permissions: ["customers.view"] })} pathname="/" />);
    expect(screen.getByText("Parties")).toBeTruthy();
    for (const label of ["Customers", "Customer groups", "Payment terms"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    for (const label of ["Suppliers", "Supplier groups", "Party settings"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    cleanup();

    render(<AppMenu user={user({ permissions: ["suppliers.view"] })} pathname="/suppliers/abc" />);
    expect(screen.getByRole("link", { name: "Suppliers" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Supplier groups" })).toBeTruthy();
    for (const label of ["Customers", "Customer groups", "Payment terms", "Party settings"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    cleanup();

    render(<AppMenu user={user({ isOwnerAdmin: true })} pathname="/" />);
    for (const label of ["Customers", "Suppliers", "Customer groups", "Supplier groups", "Payment terms"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    cleanup();

    render(<AppMenu user={user({ permissions: ["catalogue.view"] })} pathname="/" />);
    expect(screen.queryByText("Parties")).toBeNull();
  });

  it("shows the Inventory entries only with stock.view, and Settings only with stock.lock", () => {
    const inventory = ["Stock on hand", "Stock documents", "In transit", "Stock history", "Batches", "Negative stock", "Locations", "Reorder levels"];
    render(<AppMenu user={user({ permissions: ["stock.view"] })} pathname="/stock/documents/abc" />);
    expect(screen.getByText("Inventory")).toBeTruthy();
    for (const label of inventory) expect(screen.getByRole("link", { name: label })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Stock documents" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Stock on hand" }).getAttribute("aria-current")).toBeNull();
    cleanup();

    render(<AppMenu user={user({ permissions: ["catalogue.view", "customers.view"] })} pathname="/" />);
    expect(screen.queryByText("Inventory")).toBeNull();
    for (const label of [...inventory, "Settings"]) expect(screen.queryByRole("link", { name: label })).toBeNull();
    cleanup();

    render(<AppMenu user={user({ permissions: ["stock.view", "stock.lock"] })} pathname="/stock" />);
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stock on hand" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders nothing when nobody is logged in", () => {
    render(<AppMenu user={null} pathname="/" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
