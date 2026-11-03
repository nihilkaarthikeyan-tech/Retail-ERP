// Copyright (c) 2026, Rademics. All rights reserved.
// "Add all items in stock at this location" on a stock count, with batches switched off and on.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { StaticModulesProvider } from "@/lib/modules";
import type { StockLocationDto } from "@/lib/types";
import { CountEditor } from "./count-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const user = { id: "u1", firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: false, permissions: ["stock.view", "stock.count"], allStores: true, stores: [], mustChangePassword: false, roles: [] };
const STORE = { id: "c0000000-0000-4000-8000-000000000001", code: "MAIN", name: "Main Store" };
const FLOOR: StockLocationDto = { id: "d0000000-0000-4000-8000-000000000001", code: "MAIN-FLOOR", name: "Shop floor", kind: "shelf", parentId: null, store: STORE, active: true };
const BALANCE = {
  rows: [
    { item: { id: "i1", code: "ITM-000001", name: "Cotton shirt, white", unit: "PCS" }, location: { ...FLOOR, store: STORE }, quantity: "55" },
    { item: { id: "i2", code: "ITM-000002", name: "Formal trousers, grey", unit: "PCS" }, location: { ...FLOOR, store: STORE }, quantity: "36" },
  ],
  totals: {},
};

function mockApi() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/me") return new Response(JSON.stringify(user), { status: 200 });
    if (url.pathname === "/stock/balance") return new Response(JSON.stringify(BALANCE), { status: 200 });
    if (url.pathname === "/stock/batches") return new Response(JSON.stringify({ statusCode: 403, message: "Batches and expiry is switched off" }), { status: 403 });
    return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${url.pathname}` }), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(batches: boolean) {
  render(
    <AuthProvider>
      <StaticModulesProvider modules={{ batches }}>
        <CountEditor doc={null} locations={[FLOOR]} onSaved={vi.fn()} />
      </StaticModulesProvider>
    </AuthProvider>,
  );
}

describe("stock count: add all items in stock", () => {
  it("with batches switched off, lists every item from the balance without asking for batches", async () => {
    const fetchMock = mockApi();
    show(false);
    fireEvent.click(await screen.findByRole("button", { name: /Add all items in stock/ }));
    expect(await screen.findByText(/2 lines added/)).toBeTruthy();
    expect(screen.queryByText(/Batches and expiry is switched off/)).toBeNull();
    const asked = fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname);
    expect(asked).toContain("/stock/balance");
    expect(asked).not.toContain("/stock/batches");
  });

  it("with batches switched on, still asks for the batches", async () => {
    const fetchMock = mockApi();
    show(true);
    fireEvent.click(await screen.findByRole("button", { name: /Add all items in stock/ }));
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname)).toContain("/stock/batches"));
  });
});
