// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 08 §5 and scenario 8.11: the GST settings screen (in force once saved, no approval step);
// the GST rate list with exempt/nil and price bands (G2).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { bandText, GstRatesView } from "../pos/gst-rates";
import { type GstSettingsDto, GstSettingsView } from "./gst-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const user = (permissions: string[]) => ({ id: "u1", firstName: "Ravi", lastName: null, email: "ravi@example.com", isOwnerAdmin: false, permissions, allStores: true, stores: [], mustChangePassword: false, roles: [] });

const settings = (over: Partial<GstSettingsDto> = {}): GstSettingsDto => ({
  scheme: "regular",
  filingFrequency: "quarterly",
  turnoverBand: "up_to_5cr",
  hsnDigits: 4,
  eInvoiceApplies: false,
  combineSmallSales: true,
  freeSampleTax: "not_set",
  receiptTaxTable: true,
  eWayLimit: "50000.00",
  eWayStateLimits: {},
  defaultTransporterId: null,
  defaultTransporterName: null,
  ...over,
});

type Route = (init: RequestInit | undefined) => { status: number; body: unknown };
function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ?? Object.entries(routes).find(([key]) => !key.includes(" ") && url.pathname === key);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const writes = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls
    .map((c) => ({ url: new URL(String(c[0])), init: c[1] as RequestInit | undefined }))
    .filter((c) => (c.init?.method ?? "GET") !== "GET")
    .map((c) => ({ path: c.url.pathname, body: c.init?.body ? JSON.parse(String(c.init.body)) : {} }));

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

describe("GST settings (plan 08 §5, 8.11)", () => {
  it("shows the defaults, says changes apply once saved, and has no approval step", async () => {
    mockApi({ "/auth/me": () => ({ status: 200, body: user(["gst_rates.manage"]) }), "/gst/settings": () => ({ status: 200, body: settings() }) });
    render(
      <AuthProvider>
        <GstSettingsView />
      </AuthProvider>,
    );
    expect(await screen.findByText(/applies to new bills as soon as it is saved/)).toBeTruthy();
    expect((screen.getByLabelText("GST scheme") as HTMLSelectElement).value).toBe("regular");
    expect((screen.getByLabelText("HSN digits on invoices") as HTMLSelectElement).value).toBe("4");
    // Owner decision of 22 Oct 2026: no approval box, no provisional wording.
    expect(screen.queryByText(/Chartered Accountant/)).toBeNull();
    expect(screen.queryByText(/provisional/)).toBeNull();
    expect(screen.queryByRole("button", { name: /approv/i })).toBeNull();
  });

  it("a turnover above ₹5 crore switches HSN digits to 6, and saving sends the settings", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["gst_rates.manage"]) }),
      "GET /gst/settings": () => ({ status: 200, body: settings() }),
      "PATCH /gst/settings": (init) => ({ status: 200, body: settings(JSON.parse(String(init?.body))) }),
    });
    render(
      <AuthProvider>
        <GstSettingsView />
      </AuthProvider>,
    );
    const band = (await screen.findByLabelText(/Turnover band/)) as HTMLSelectElement;
    fireEvent.change(band, { target: { value: "above_10cr" } });
    expect((screen.getByLabelText("HSN digits on invoices") as HTMLSelectElement).value).toBe("6");
    fireEvent.change(screen.getByLabelText("GST scheme"), { target: { value: "composition" } });
    fireEvent.click(screen.getByRole("button", { name: "Save GST settings" }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    expect(writes(fetchMock)[0]).toMatchObject({ path: "/gst/settings", body: { scheme: "composition", turnoverBand: "above_10cr", hsnDigits: 6, eWayLimit: "50000.00" } });
    expect(await screen.findByText("GST settings saved.")).toBeTruthy();
  });
});

describe("GST rate list with price bands (G2)", () => {
  it("describes bands in plain words", () => {
    expect(bandText({ priceFrom: null, priceUpTo: "2500.00" })).toBe("Up to ₹2500.00");
    expect(bandText({ priceFrom: "2500.00", priceUpTo: null })).toBe("Above ₹2500.00");
    expect(bandText({ priceFrom: null, priceUpTo: null })).toBe("Any price");
  });

  it("sends a price band and shows nil-rated codes by kind", async () => {
    const fetchMock = mockApi({
      "/auth/me": () => ({ status: 200, body: user(["gst_rates.manage"]) }),
      "GET /pos/gst-rates": () => ({
        status: 200,
        body: [{ id: "r1", hsnCode: "0401", rate: "0", cessRate: "0", kind: "nil", priceFrom: null, priceUpTo: null, effectiveFrom: "2026-10-01", note: null }],
      }),
      "POST /pos/gst-rates": () => ({ status: 201, body: {} }),
    });
    render(
      <AuthProvider>
        <GstRatesView />
      </AuthProvider>,
    );
    expect(await screen.findByText("Nil-rated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a rate" }));
    fireEvent.change(screen.getByLabelText(/HSN code/, { selector: "input#gst-hsn" }), { target: { value: "6205" } });
    fireEvent.change(screen.getByLabelText(/GST %/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Starts on/), { target: { value: "2025-09-22" } });
    fireEvent.change(screen.getByLabelText(/Only up to this selling price/), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    expect(writes(fetchMock)[0]).toMatchObject({ path: "/pos/gst-rates", body: { hsnCode: "6205", rate: "5", kind: "taxable", priceFrom: null, priceUpTo: "2500", effectiveFrom: "2025-09-22" } });
  });
});
