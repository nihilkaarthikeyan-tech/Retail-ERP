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

  it("renders nothing when nobody is logged in", () => {
    render(<AppMenu user={null} pathname="/" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
