// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, PermissionKey } from "shared";
import { AuthProvider } from "@/lib/auth-context";
import { defaultPeriod, periodOptions, stateText } from "@/lib/gst-returns";
import { isActive, MENU, visibleMenu } from "@/lib/menu";
import { visibleReports } from "@/lib/reports";
import { Gstr1Report, Gstr3bReport, NotesRegisterReport } from "./gst-returns";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/reports/gst/gstr1",
}));

const user = (permissions: PermissionKey[]): CurrentUser => ({
  id: "u1",
  firstName: "Meena",
  lastName: null,
  email: "meena@example.com",
  isOwnerAdmin: false,
  permissions,
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
});

type Route = (url: URL) => { status: number; body: unknown };
function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${url.pathname}` }), { status: 404 });
    const { status, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const ok = (body: unknown) => () => ({ status: 200, body });
const paths = (fn: ReturnType<typeof vi.fn>, path: string) => fn.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname === path);

const REGS = { filingFrequency: "monthly", currentPeriod: "2026-10", registrations: [{ id: "r1", gstin: "33AAACR1234A1ZV", stateCode: "33", isDefault: true, active: true, stores: [{ id: "s1", code: "MAIN", name: "Main" }] }] };
const header = { gstin: "33AAACR1234A1ZV", gstRegistrationId: "r1", stateCode: "33", period: "2026-09", periodLabel: "September 2026", from: "2026-09-01", to: "2026-09-30", fp: "092026", filingFrequency: "monthly", workedOutAt: "2026-10-16T09:00:00.000Z" };
const F = (taxable: string, igst = "0.00", cgst = "0.00", sgst = "0.00") => ({ taxable, igst, cgst, sgst, cess: "0.00", tax: "0.00" });
const item = (rate: string, taxable: string, igst: string) => ({ rate, taxable, igst, cgst: "0.00", sgst: "0.00", cess: "0.00" });

const GSTR1 = {
  ...header,
  b2b: [{ number: "INV/1", date: "2026-09-02", value: "1050.00", placeOfSupply: "29", buyerGstin: "29AABCK1234A1Z5", reverseCharge: false, items: [item("5.00", "1000.00", "50.00")] }],
  b2cl: [],
  b2cs: [{ supplyType: "INTRA", placeOfSupply: "33", rate: "5.00", taxable: "1100.00", igst: "0.00", cgst: "27.50", sgst: "27.50", cess: "0.00" }],
  cdnr: [],
  cdnur: [],
  nil: [],
  hsnBusiness: [{ hsn: "6205", description: "", uqc: "PCS", quantity: "1", rate: "5.00", taxable: "1000.00", igst: "50.00", cgst: "0.00", sgst: "0.00", cess: "0.00" }],
  hsnConsumer: [],
  documents: [{ nature: 1, natureLabel: "Invoices for outward supply", series: "INV/", from: "INV/1", to: "INV/6", total: 6, cancelled: 1, net: 5, missing: 0 }],
  smallSales: [],
  combineSmallSales: true,
  excludedBills: 0,
  reconciliation: { register: F("2100.00", "50.00", "27.50", "27.50"), sections: { b2b: F("1000.00", "50.00"), b2cs: F("1100.00", "0.00", "27.50", "27.50") }, sectionsTotal: F("2100.00", "50.00", "27.50", "27.50"), sectionsAgree: true, hsnTotal: F("2100.00"), hsnAgrees: true, documentsNet: 5, registerDocuments: 5, documentsAgree: true },
  warnings: ["2 bill numbers are longer than 16 characters"],
};

const H = (igst: string, cgst: string, sgst: string, total: string) => ({ igst, cgst, sgst, total });
const GSTR3B = {
  ...header,
  outward: { taxable: F("2100.00", "0.00", "52.50", "52.50"), zeroRated: F("0.00"), nilExempt: "30.00", reverseChargeInward: F("10000.00", "0.00", "900.00", "900.00"), nonGst: "0.00" },
  interStateUnregistered: [],
  outputTaxFromBills: H("0.00", "52.50", "52.50", "105.00"),
  outputTaxFromAccounts: H("0.00", "52.50", "52.50", "105.00"),
  credit: { reverseCharge: H("0.00", "900.00", "900.00", "1800.00"), allOther: H("180.00", "9.00", "9.00", "198.00"), reversed: H("0.00", "0.00", "0.00", "0.00"), net: H("180.00", "909.00", "909.00", "1998.00"), ineligible: H("0.00", "45.00", "45.00", "90.00"), broughtForward: H("0.00", "0.00", "0.00", "0.00"), available: H("180.00", "909.00", "909.00", "1998.00") },
  setOff: { steps: [{ credit: "igst", against: "cgst", amount: "52.50" }, { credit: "igst", against: "sgst", amount: "52.50" }], paidByCredit: H("0.00", "52.50", "52.50", "105.00"), cash: H("0.00", "0.00", "0.00", "0.00") },
  reverseChargePayable: H("0.00", "900.00", "900.00", "1800.00"),
  netPayable: H("0.00", "900.00", "900.00", "1800.00"),
  totalPayable: "1800.00",
  creditCarriedForward: H("75.00", "909.00", "909.00", "1893.00"),
  notes: [],
};

beforeEach(() => {
  search = "";
  replace.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GST return helpers", () => {
  it("offers the current period and the ones before, and defaults to the last complete one", () => {
    expect(periodOptions("2026-10", 3).map((o) => o.value)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(periodOptions("2026-10", 1)[0].label).toBe("October 2026 (so far)");
    expect(periodOptions("2026-Q3", 2).map((o) => o.value)).toEqual(["2026-Q3", "2026-Q2"]);
    expect(defaultPeriod("2026-10")).toBe("2026-09");
    expect(defaultPeriod("2026-Q1")).toBe("2025-Q4");
    expect(stateText("29")).toBe("29 Karnataka");
  });

  it("lists the GST reports and the menu entry only for those with the right", () => {
    expect(visibleReports(user(["gst.returns"])).filter((r) => r.frequency === "gst").map((r) => r.id)).toEqual(["gst-sales-register", "gst-gstr1", "gst-gstr3b", "gst-notes"]);
    expect(visibleReports(user(["accounts.view"])).some((r) => r.frequency === "gst")).toBe(false);
    const entry = MENU.find((e) => e.href === "/reports/gst")!;
    expect(visibleMenu(user(["gst.returns"]))).toContain(entry);
    expect(visibleMenu(user(["pos.reports"]))).not.toContain(entry);
    expect(isActive(entry, "/reports/gst/gstr1")).toBe(true);
    expect(isActive(MENU.find((e) => e.href === "/reports")!, "/reports/gst/gstr1")).toBe(false);
  });
});

describe("GSTR-1 screen", () => {
  it("shows that the sections add up, the warnings, each section, and asks for last month by default", async () => {
    const fetch = mockApi({ "/auth/me": ok(user(["gst.returns"])), "/reports/gst/registrations": ok(REGS), "/reports/gst/gstr1": ok(GSTR1), "/company": ok(null) });
    render(
      <AuthProvider>
        <Gstr1Report />
      </AuthProvider>,
    );
    expect(await screen.findByText(/add up to the sales tax register/)).toBeTruthy();
    expect(screen.getByText("2 bill numbers are longer than 16 characters")).toBeTruthy();
    expect(screen.getByText("29AABCK1234A1Z5")).toBeTruthy();
    expect(screen.getByText("Invoices for outward supply")).toBeTruthy();
    const asked = paths(fetch, "/reports/gst/gstr1")[0];
    expect(asked.searchParams.get("period")).toBe("2026-09");
    expect(asked.searchParams.get("gstRegistrationId")).toBe("r1");
  });

  it("downloads the portal JSON from the API (which records it in the history)", async () => {
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:gstr1"), configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetch = mockApi({ "/auth/me": ok(user(["gst.returns"])), "/reports/gst/registrations": ok(REGS), "/reports/gst/gstr1": ok(GSTR1), "/reports/gst/gstr1/json": ok({ gstin: "33AAACR1234A1ZV", fp: "092026" }), "/company": ok(null) });
    render(
      <AuthProvider>
        <Gstr1Report />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Download GSTR-1 for the GST portal (JSON)" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const asked = paths(fetch, "/reports/gst/gstr1/json")[0];
    expect(asked.searchParams.get("period")).toBe("2026-09");
  });

  it("says plainly when the figures do not add up", async () => {
    mockApi({ "/auth/me": ok(user(["gst.returns"])), "/reports/gst/registrations": ok(REGS), "/reports/gst/gstr1": ok({ ...GSTR1, reconciliation: { ...GSTR1.reconciliation, hsnAgrees: false } }), "/company": ok(null) });
    render(
      <AuthProvider>
        <Gstr1Report />
      </AuthProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not add up.*HSN summary/);
  });

  it("refuses those without the right", async () => {
    mockApi({ "/auth/me": ok(user(["pos.reports"])), "/company": ok(null) });
    render(
      <AuthProvider>
        <Gstr1Report />
      </AuthProvider>,
    );
    expect(await screen.findByText(/do not have the right to see this report/)).toBeTruthy();
  });
});

describe("GSTR-3B screen", () => {
  it("shows the set-off in order, the net payable and the credit carried forward", async () => {
    search = "period=2026-09";
    mockApi({ "/auth/me": ok(user(["gst.returns"])), "/reports/gst/registrations": ok(REGS), "/reports/gst/gstr3b": ok(GSTR3B), "/company": ok(null) });
    render(
      <AuthProvider>
        <Gstr3bReport />
      </AuthProvider>,
    );
    const steps = await screen.findAllByText(/IGST credit used for/);
    expect(steps.map((s) => s.textContent)).toEqual(["IGST credit used for CGST: ₹52.50", "IGST credit used for SGST: ₹52.50"]);
    expect(screen.getByText("Net GST payable")).toBeTruthy();
    expect(screen.getByText("Input credit carried forward")).toBeTruthy();
    expect(document.querySelector(".report-headline")?.textContent).toContain("₹1,800.00");
  });
});

describe("credit and debit note register", () => {
  it("flags a credit note after the 30 November deadline", async () => {
    mockApi({
      "/auth/me": ok(user(["gst.returns"])),
      "/reports/gst/registrations": ok(REGS),
      "/reports/gst/notes": ok({
        ...header,
        rows: [{ billId: "b1", kind: "credit_note", number: "INV/9", date: "2026-12-02", store: "MAIN", party: "Consumer", originalNumber: "INV/1", originalDate: "2025-06-01", deadline: "2026-11-30", status: "late", section: "b2cs", value: "-1050.00", ...F("-1000.00", "0.00", "-25.00", "-25.00") }],
        totals: { creditNotes: 1, debitNotes: 0, late: 1, near: 0 },
      }),
      "/company": ok(null),
    });
    render(
      <AuthProvider>
        <NotesRegisterReport />
      </AuthProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/1 credit notes are after the 30 November deadline/);
    expect(screen.getByText("After the deadline: tax cannot be reduced")).toBeTruthy();
  });
});
