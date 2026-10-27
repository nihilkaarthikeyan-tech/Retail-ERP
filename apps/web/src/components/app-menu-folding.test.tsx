// Copyright (c) 2026, Rademics. All rights reserved.
// Owner, 27 October 2026 (decision L11): an owner faced 84 links in 9 open groups. Groups now
// start folded, the group of the current screen is always open, and opened groups are remembered.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CurrentUser } from "shared";
import { afterEach, describe, expect, it } from "vitest";
import { setMenuUser } from "@/lib/menu-usage";
import { AppMenu } from "./app-menu";

let n = 0;
function owner(): CurrentUser {
  const id = `owner-${++n}`;
  act(() => setMenuUser(id));
  return { id, firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: true, permissions: [], allStores: true, stores: [], mustChangePassword: false, roles: [] };
}

const heading = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("folding menu", () => {
  it("starts with every group folded to one line with its number of screens", () => {
    render(<AppMenu user={owner()} pathname="/dashboard" />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Item groups" })).toBeNull();
    expect(heading("Items").getAttribute("aria-expanded")).toBe("false");
    expect(heading("Items").querySelector(".shell-nav-count")?.textContent).toMatch(/^\d+ screens$/);
    expect(parseInt(heading("Items").querySelector(".shell-nav-count")?.textContent ?? "", 10)).toBeGreaterThan(3);
    // Only Dashboard and whatever stands outside a group are links at first: far fewer than 84.
    expect(screen.getAllByRole("link").length).toBeLessThan(5);
  });

  it("lists the groups in the order a shop works through its day, billing first (owner, 27 October 2026)", () => {
    render(<AppMenu user={owner()} pathname="/dashboard" />);
    const names = screen.getAllByRole("button").map((b) => b.childNodes[0]?.textContent);
    expect(names).toEqual(["Billing counter", "Items", "Stock", "Purchases", "Customers and suppliers", "Accounts", "Reports", "Printing and data", "Administration"]);
  });

  it("keeps the group of the current screen open, and it cannot be folded", () => {
    render(<AppMenu user={owner()} pathname="/catalogue/brands" />);
    expect(screen.getByRole("link", { name: "Brands" }).getAttribute("aria-current")).toBe("page");
    expect((heading("Items") as HTMLButtonElement).disabled).toBe(true);
    expect(heading("Accounts").getAttribute("aria-expanded")).toBe("false");
  });

  it("a group opened by the person stays open on the next visit, and folds again with a click", () => {
    const me = owner();
    const first = render(<AppMenu user={me} pathname="/dashboard" />);
    fireEvent.click(heading("Accounts"));
    expect(screen.getByRole("link", { name: "Accounts reports" })).toBeTruthy();
    first.unmount();
    render(<AppMenu user={me} pathname="/dashboard" />);
    expect(screen.getByRole("link", { name: "Accounts reports" })).toBeTruthy();
    fireEvent.click(heading("Accounts"));
    expect(screen.queryByRole("link", { name: "Accounts reports" })).toBeNull();
  });
});
