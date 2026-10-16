// Copyright (c) 2026, Rademics. All rights reserved.
// Scenario 11.17 (plan 11 C5): the markdown screen previews old and new prices
// with the MRP check, then applies them and offers the labels.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { MarkdownTool } from "./markdown-tool";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const SEASON = "5e000000-0000-4000-8000-000000000000";
const user = (permissions: string[]) => ({ id: "u1", firstName: "Asha", lastName: null, email: "asha@example.com", isOwnerAdmin: false, permissions, allStores: true, stores: [], mustChangePassword: false, roles: [] });

const preview = {
  priceList: { id: "l1", code: "STD-SELL", name: "Standard selling" },
  items: 3,
  toChange: 2,
  skipped: 1,
  cappedAtMrp: 1,
  lines: [
    { itemId: "i1", code: "SHIRT-RED-M", name: "Oxford shirt Red M", mrp: "1099.00", oldPrice: "799.00", newPrice: "559.00", cappedAtMrp: false, skipped: null },
    { itemId: "i2", code: "SHIRT-RED-L", name: "Oxford shirt Red L", mrp: "500.00", oldPrice: "799.00", newPrice: "500.00", cappedAtMrp: true, skipped: null },
    { itemId: "i3", code: "SHIRT-RED-S", name: "Oxford shirt Red S", mrp: null, oldPrice: null, newPrice: null, cappedAtMrp: false, skipped: "No price in this list to take the percentage off" },
  ],
};
const applied = { id: "md000000-0000-4000-8000-000000000000", priceList: preview.priceList, rule: "percent", value: "30", startDate: "2026-11-01", endDate: null, status: "upcoming", itemCount: 2, remark: "End of summer", createdAt: "2026-10-16T10:00:00Z", createdBy: "Asha" };

function mockApi(permissions: string[]) {
  const history: unknown[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/auth/me") return ok(user(permissions));
    if (url.pathname === "/price-lists") return ok([{ id: "l1", code: "STD-SELL", name: "Standard selling", forSelling: true, forBuying: false, currency: "INR", pricesPerUnit: false, active: true }]);
    if (url.pathname === "/seasons") return ok([{ id: SEASON, code: "SUMMER26", name: "Summer 2026", startsOn: null, endsOn: null, active: true }]);
    if (url.pathname === "/catalogue/item-groups" || url.pathname === "/catalogue/brands") return ok([]);
    if (url.pathname === "/markdowns/preview") return ok(preview);
    if (url.pathname === "/markdowns" && init?.method === "POST") {
      history.push(applied);
      return ok(applied, 201);
    }
    if (url.pathname === "/markdowns") return ok(history);
    return ok({ statusCode: 404, message: "No route" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const posts = (fn: ReturnType<typeof vi.fn>, path: string) =>
  fn.mock.calls.filter((c) => new URL(String(c[0])).pathname === path && (c[1] as RequestInit | undefined)?.method === "POST").map((c) => JSON.parse(String((c[1] as RequestInit).body)));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarkdownTool", () => {
  it("previews 30% off a season, then applies it and links to the labels", async () => {
    const fetchMock = mockApi(["prices.view", "prices.manage", "catalogue.view"]);
    render(
      <AuthProvider>
        <MarkdownTool />
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Season"), { target: { value: SEASON } });
    fireEvent.change(screen.getByLabelText(/Percentage off/, { selector: "input[type=text], input:not([type])" }), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Remark"), { target: { value: "End of summer" } });
    const apply = screen.getByRole("button", { name: "Apply the new prices" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("SHIRT-RED-M")).toBeTruthy();
    const row = screen.getByText("SHIRT-RED-L").closest("tr")!;
    expect(within(row).getByText("Brought down to the MRP")).toBeTruthy();
    expect(screen.getByText(/Left out: No price/)).toBeTruthy();
    expect(screen.getByText(/2 of 3 items will get a new price/)).toBeTruthy();
    expect(posts(fetchMock, "/markdowns/preview")[0]).toEqual({ priceListId: null, seasonId: SEASON, itemGroupIds: [], brandIds: [], itemIds: [], rule: "percent", value: "30", startDate: "2026-11-01", endDate: null, remark: "End of summer" });

    fireEvent.click(apply);
    expect(await screen.findByText(/New prices added for 2 items/)).toBeTruthy();
    expect(posts(fetchMock, "/markdowns")).toHaveLength(1);
    const links = screen.getAllByRole("link", { name: /Print the labels|Print labels/ });
    expect(links[0].getAttribute("href")).toBe(`/labels?markdownId=${applied.id}`);
    await waitFor(() => expect(screen.getByText("30% off")).toBeTruthy());
  });

  it("refuses to preview without a choice of items", async () => {
    const fetchMock = mockApi(["prices.view", "prices.manage"]);
    render(
      <AuthProvider>
        <MarkdownTool />
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText(/Percentage off/, { selector: "input:not([type=radio])" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Choose a season, groups, brands or items")).toBeTruthy();
    expect(posts(fetchMock, "/markdowns/preview")).toHaveLength(0);
  });

  it("shows past markdowns but no form without the price right", async () => {
    mockApi(["prices.view"]);
    render(
      <AuthProvider>
        <MarkdownTool />
      </AuthProvider>,
    );
    expect(await screen.findByText(/You can see past markdowns but not make new ones/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });
});
