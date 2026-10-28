// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12, scenarios 12.3 and 12.5 on screen: the owner switches modules, sees
// the warnings before switching off, and applies a shop type after a preview.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type CurrentUser, MODULE_KEYS, type ModuleKey, type ModuleSwitchResult, type ShopTypeResult } from "shared";
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppMenu } from "@/components/app-menu";
import { AuthProvider } from "@/lib/auth-context";
import { ModulesProvider } from "@/lib/modules";
import { MyModulesScreen } from "./my-modules";
import { openEveryMenuGroup } from "@/lib/menu-test-helpers";

// These tests are about who sees which screen, not about folding (decision L11).
beforeEach(openEveryMenuGroup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/settings/modules",
}));

const person = (isOwnerAdmin: boolean): CurrentUser => ({
  id: "u1",
  firstName: "Karthik",
  lastName: null,
  email: "owner@example.com",
  isOwnerAdmin,
  permissions: isOwnerAdmin ? [] : ["catalogue.view", "orders.manage"],
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
});

type Map = Record<ModuleKey, boolean>;
const allOn = (): Map => Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Map;

type Route = (url: URL, body: Record<string, unknown>) => { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = route(url, init?.body ? JSON.parse(String(init.body)) : {});
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function writes(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls
    .filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") !== "GET")
    .map((c) => ({ path: new URL(String(c[0])).pathname, body: JSON.parse(String((c[1] as RequestInit).body)) }));
}

function renderScreen() {
  return render(
    <AuthProvider>
      <ModulesProvider>
        <AppMenu user={person(true)} pathname="/settings/modules" />
        <MyModulesScreen />
      </ModulesProvider>
    </AuthProvider>,
  );
}

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

describe("My modules", () => {
  it("switching off with open orders warns first; confirming switches it off and the menu hides it", async () => {
    const map = allOn();
    const fetch = mockApi({
      "GET /auth/me": () => ({ status: 200, body: person(true) }),
      "GET /modules": () => ({ status: 200, body: { shopType: "clothing", modules: map } }),
      "PATCH /modules/customer_orders": (_u, body) => {
        if (!body.confirm) {
          const r: ModuleSwitchResult = { done: false, needsConfirm: true, warnings: ["3 customer orders are still open"], switchedOn: [], switchedOff: ["customer_orders"], message: "", shopType: "clothing", modules: map };
          return { status: 200, body: r };
        }
        map.customer_orders = false;
        const r: ModuleSwitchResult = { done: true, needsConfirm: false, warnings: ["3 customer orders are still open"], switchedOn: [], switchedOff: ["customer_orders"], message: "Customer orders is switched off.", shopType: "clothing", modules: { ...map } };
        return { status: 200, body: r };
      },
    });
    renderScreen();
    const sw = await screen.findByRole("switch", { name: "Customer orders" });
    await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByText(/Your shop type is/).textContent).toMatch(/Clothing/);
    expect(screen.getByRole("link", { name: "Customer orders" })).toBeTruthy();

    fireEvent.click(sw);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("3 customer orders are still open")).toBeTruthy();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy();
    // Nothing changed yet.
    expect((screen.getByRole("switch", { name: "Customer orders" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch off anyway" }));
    expect(await screen.findByText("Customer orders is switched off.")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Customer orders" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("link", { name: "Customer orders" })).toBeNull();
    expect(writes(fetch)).toEqual([
      { path: "/modules/customer_orders", body: { enabled: false } },
      { path: "/modules/customer_orders", body: { enabled: false, confirm: true } },
    ]);
  }, 15_000); // renders the whole menu; slow when every test file runs at once

  it("switching on Alterations says Salesperson came on too", async () => {
    const map = { ...allOn(), alterations: false, salesperson: false };
    mockApi({
      "GET /auth/me": () => ({ status: 200, body: person(true) }),
      "GET /modules": () => ({ status: 200, body: { shopType: null, modules: map } }),
      "PATCH /modules/alterations": () => {
        const r: ModuleSwitchResult = {
          done: true,
          needsConfirm: false,
          warnings: [],
          switchedOn: ["alterations", "salesperson"],
          switchedOff: [],
          message: "Alterations is switched on. Salesperson is switched on too, because Alterations needs it.",
          shopType: null,
          modules: { ...map, alterations: true, salesperson: true },
        };
        return { status: 200, body: r };
      },
    });
    renderScreen();
    await waitFor(() => expect((screen.getByRole("switch", { name: "Alterations" }) as HTMLInputElement).checked).toBe(false));
    expect(screen.getByText(/Needs Salesperson/)).toBeTruthy();
    expect(screen.getByText("Alterations needs this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Alterations" }));
    expect(await screen.findByText(/Salesperson is switched on too/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Salesperson" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("link", { name: "Alterations" })).toBeTruthy();
  });

  it("someone other than the Owner sees the list but cannot switch anything", async () => {
    const fetch = mockApi({
      "GET /auth/me": () => ({ status: 200, body: person(false) }),
      "GET /modules": () => ({ status: 200, body: { shopType: "fancy", modules: { ...allOn(), variants: false } } }),
    });
    render(
      <AuthProvider>
        <ModulesProvider>
          <MyModulesScreen />
        </ModulesProvider>
      </AuthProvider>,
    );
    expect(await screen.findByText("Only the Owner can switch modules or change the shop type.")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("switch", { name: "Sizes and colours" }) as HTMLInputElement).checked).toBe(false));
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Apply a shop type")).toBeNull();
    expect(writes(fetch)).toEqual([]);
  });

  it("a shop type is applied only after the preview is confirmed; nothing is deleted", async () => {
    const map = allOn();
    const preview: ShopTypeResult = {
      done: false,
      needsConfirm: true,
      type: "cosmetics",
      label: "Cosmetics and beauty",
      switchOn: [],
      switchOff: ["variants", "serials"],
      warnings: ["2 styles have sizes and colours"],
      itemGroups: ["Make-up", "Skin care"],
      attributes: [],
      hsnCodes: [],
      message: "",
      shopType: "clothing",
      modules: map,
    };
    const fetch = mockApi({
      "GET /auth/me": () => ({ status: 200, body: person(true) }),
      "GET /modules": () => ({ status: 200, body: { shopType: "clothing", modules: map } }),
      "POST /modules/shop-type": (_u, body) =>
        body.confirm
          ? { status: 200, body: { ...preview, done: true, needsConfirm: false, message: "Cosmetics and beauty is applied. Nothing was deleted.", shopType: "cosmetics", modules: { ...map, variants: false, serials: false } } }
          : { status: 200, body: preview },
    });
    renderScreen();
    const select = await screen.findByLabelText("Apply a shop type");
    fireEvent.change(select, { target: { value: "cosmetics" } });
    fireEvent.click(screen.getByRole("button", { name: "See what changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Switches off \(hidden, not deleted\): Sizes and colours and Serial numbers and warranty/)).toBeTruthy();
    expect(within(dialog).getByText("Adds item groups: Make-up and Skin care.")).toBeTruthy();
    expect(within(dialog).getByText("2 styles have sizes and colours")).toBeTruthy();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy();
    expect(writes(fetch)).toEqual([{ path: "/modules/shop-type", body: { type: "cosmetics" } }]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply shop type" }));
    expect(await screen.findByText("Cosmetics and beauty is applied. Nothing was deleted.")).toBeTruthy();
    expect(writes(fetch)[1]).toEqual({ path: "/modules/shop-type", body: { type: "cosmetics", confirm: true } });
    expect((screen.getByRole("switch", { name: "Sizes and colours" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("link", { name: "Attributes" })).toBeNull();
    expect(screen.getByText(/Your shop type is/).textContent).toMatch(/Cosmetics and beauty/);
  });
});
