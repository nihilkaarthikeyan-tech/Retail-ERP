// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { ItemsList } from "./items-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const owner = {
  id: "u1",
  firstName: "Asha",
  lastName: null,
  email: "owner@example.com",
  isOwnerAdmin: true,
  permissions: [],
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
};

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "RICE-5",
  name: "Rice 5 kg",
  description: null,
  hasImage: false,
  itemGroup: { id: "g1", code: "RICE", name: "Rice" },
  brand: null,
  baseUnit: { id: "un1", code: "PCS", name: "Piece", allowsFractions: false },
  hsnCode: null,
  mrp: "450.00",
  maxDiscountPercent: "0",
  isStockItem: true,
  canBuy: true,
  canSell: true,
  endDate: null,
  active: true,
  isParentStyle: false,
  parent: null,
  variantCount: 0,
  trackBatches: false,
  autoNumberBatches: true,
  shelfLifeDays: null,
  trackSerials: false,
  warrantyDays: null,
  units: [],
  barcodes: [],
  variantAttributes: [],
  variantValues: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

/** Routes fetch calls by path and records them. */
function mockApi(routes: Record<string, (url: URL) => { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const match = Object.entries(routes).find(([path]) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calls(fn: ReturnType<typeof vi.fn>, path: string): URL[] {
  return fn.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname.startsWith(path));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("ItemsList", () => {
  it("calls the scan endpoint on Enter with a barcode and opens the item", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: owner }),
      "/catalogue/item-groups": () => ({ status: 200, body: [] }),
      "/catalogue/brands": () => ({ status: 200, body: [] }),
      "/items": () => ({ status: 200, body: { rows: [item], total: 1, page: 1, pageSize: 50 } }),
      "/catalogue/scan": () => ({
        status: 200,
        body: { item, unit: { id: "un1", code: "PCS", name: "Piece", factor: "1" }, matchedBy: "barcode", usable: true, reason: null },
      }),
    });
    render(
      <AuthProvider>
        <ItemsList />
      </AuthProvider>,
    );
    expect(await screen.findByText("Rice 5 kg")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "8901234567890" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/items/${item.id}`));
    const scanCalls = calls(fetchMock, "/catalogue/scan");
    expect(scanCalls).toHaveLength(1);
    expect(scanCalls[0].pathname).toBe("/catalogue/scan/8901234567890");
  });

  it("filters the list when the text is not a known code", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: owner }),
      "/catalogue/item-groups": () => ({ status: 200, body: [] }),
      "/catalogue/brands": () => ({ status: 200, body: [] }),
      "/items": (url) => ({
        status: 200,
        body: url.searchParams.get("search") === "basmati" ? { rows: [], total: 0, page: 1, pageSize: 50 } : { rows: [item], total: 1, page: 1, pageSize: 50 },
      }),
      "/catalogue/scan": () => ({ status: 404, body: { statusCode: 404, message: "Nothing found" } }),
    });
    render(
      <AuthProvider>
        <ItemsList />
      </AuthProvider>,
    );
    expect(await screen.findByText("Rice 5 kg")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "basmati" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText('No items match "basmati".')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    const listCalls = calls(fetchMock, "/items");
    expect(listCalls[listCalls.length - 1].searchParams.get("search")).toBe("basmati");
  });

  it("searches with spaces straight away without trying a scan", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: owner }),
      "/catalogue/item-groups": () => ({ status: 200, body: [] }),
      "/catalogue/brands": () => ({ status: 200, body: [] }),
      "/items": () => ({ status: 200, body: { rows: [item], total: 1, page: 1, pageSize: 50 } }),
    });
    render(
      <AuthProvider>
        <ItemsList />
      </AuthProvider>,
    );
    expect(await screen.findByText("Rice 5 kg")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rice 5" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => expect(calls(fetchMock, "/items").some((u) => u.searchParams.get("search") === "rice 5")).toBe(true));
    expect(calls(fetchMock, "/catalogue/scan")).toHaveLength(0);
  });
});
