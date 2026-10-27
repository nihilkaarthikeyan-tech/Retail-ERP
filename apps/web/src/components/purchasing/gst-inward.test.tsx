// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { periodChoices } from "@/lib/gst-inward";
import { InputCreditMatching, PurchaseTaxRegister } from "./gst-inward";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/purchases",
}));

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

const REG = { id: "r1111111-1111-4111-8111-111111111111", gstin: "33AAACR1234A1ZA", stateCode: "33", legalNameOnCertificate: null, addressLine1: null, addressLine2: null, city: null, pincode: null, isDefault: true, active: true };
const me = { id: "u1", firstName: "Anand", lastName: null, email: "a@example.com", isOwnerAdmin: false, permissions: ["gst.input_credit", "company.view"], allStores: true, stores: [], mustChangePassword: false, roles: [] };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ?? Object.entries(routes).find(([key]) => !key.includes(" ") && url.pathname === key);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const common: Record<string, Route> = {
  "/auth/me": () => ({ status: 200, body: me }),
  "/company/gst-registrations": () => ({ status: 200, body: [REG] }),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("periods", () => {
  it("lists months newest first, then quarters of the financial year that have started", () => {
    const p = periodChoices("2026-10-18", 3);
    expect(p.slice(0, 3).map((x) => x.value)).toEqual(["2026-10", "2026-09", "2026-08"]);
    const quarters = p.filter((x) => x.value.includes("Q")).map((x) => x.value);
    expect(quarters.slice(0, 3)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
    expect(quarters).toContain("2025-Q4");
    expect(quarters).not.toContain("2026-Q4");
  });
});

describe("purchase tax register", () => {
  it("shows the bills of the GSTIN with credit claimable and reverse charge", async () => {
    const fetchMock = mockApi({
      ...common,
      "/gst/purchase-register": (url) => ({
        status: 200,
        body: {
          gstin: REG.gstin,
          gstRegistrationId: url.searchParams.get("gstRegistrationId"),
          from: "2026-10-01",
          to: "2026-10-31",
          rows: [
            { billId: "b1", number: "PB-2026-27-00001", kind: "invoice", supplierBillNo: "RC/9", supplierBillDate: "2026-10-05", postingDate: "2026-10-05", supplier: { id: "s1", code: "SUP-1", name: "Road Carriers" }, supplierGstin: null, placeOfSupply: "33", rates: "18%", taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", tax: "180.00", creditClaimable: "180.00", creditNotClaimable: "0.00", reverseCharge: true, total: "1000.00" },
          ],
          totals: { taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", tax: "180.00", creditClaimable: "180.00", creditNotClaimable: "0.00", reverseChargeTax: "180.00", total: "1000.00" },
        },
      }),
    });
    render(
      <AuthProvider>
        <PurchaseTaxRegister />
      </AuthProvider>,
    );
    expect(await screen.findByText("Road Carriers")).toBeTruthy();
    expect(screen.getByText("Unregistered")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("GST payable by the shop under reverse charge")).toBeTruthy();
    const call = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname === "/gst/purchase-register")!;
    expect(call.searchParams.get("gstRegistrationId")).toBe(REG.id);
    expect(call.searchParams.get("period")).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("input credit matching", () => {
  const upload = { id: "u2222222-2222-4222-8222-222222222222", gstRegistrationId: REG.id, gstin: REG.gstin, period: "2026-09", fileName: "GSTR2B.json", uploadedAt: "2026-10-12T05:00:00.000Z" };
  const result = {
    upload,
    summary: { matched: 1, value_difference: 1, only_portal: 0, only_books: 1 },
    rows: [
      { status: "value_difference", supplierGstin: "33AAHCS1234J1ZJ", supplierName: "Sri Ganesh", number: "SGT/002", kind: "invoice", portal: { date: "2026-09-10", taxable: "3200.00", igst: "0.00", cgst: "80.00", sgst: "80.00", reverseCharge: false, itcAvailable: "Y" }, books: { id: "b2", ourNumber: "PB-2", date: "2026-09-10", taxable: "3000.00", igst: "0.00", cgst: "75.00", sgst: "75.00", reverseCharge: false }, differences: ["Taxable value: portal ₹3200.00, books ₹3000.00"] },
      { status: "only_books", supplierGstin: "33AAHCS1234J1ZJ", supplierName: "Sri Ganesh", number: "SGT/003", kind: "invoice", portal: null, books: { id: "b3", ourNumber: "PB-3", date: "2026-09-12", taxable: "4000.00", igst: "0.00", cgst: "100.00", sgst: "100.00", reverseCharge: false }, differences: [] },
      { status: "matched", supplierGstin: "33AAHCS1234J1ZJ", supplierName: "Sri Ganesh", number: "sgt-1", kind: "invoice", portal: { date: "2026-09-01", taxable: "2000.00", igst: "0.00", cgst: "50.00", sgst: "50.00", reverseCharge: false, itcAvailable: "Y" }, books: { id: "b1", ourNumber: "PB-1", date: "2026-09-01", taxable: "2000.00", igst: "0.00", cgst: "50.00", sgst: "50.00", reverseCharge: false }, differences: [] },
    ],
  };

  it("uploads the portal file and shows what matches, with a filter per result", async () => {
    let uploaded = false;
    const fetchMock = mockApi({
      ...common,
      "GET /gst/inward-statements": () => ({ status: 200, body: uploaded ? [upload] : [] }),
      "POST /gst/inward-statements": () => {
        uploaded = true;
        return { status: 201, body: { ...upload, documents: 3 } };
      },
      [`/gst/inward-statements/${upload.id}/match`]: () => ({ status: 200, body: result }),
    });
    render(
      <AuthProvider>
        <InputCreditMatching />
      </AuthProvider>,
    );
    expect(await screen.findByText("No statement has been uploaded for this GSTIN yet.")).toBeTruthy();
    const file = new File([JSON.stringify({ data: {} })], "GSTR2B.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("GSTR-2B JSON file"), { target: { files: [file] } });
    expect(await screen.findByText(/GSTR2B.json: 3 documents for 33AAACR1234A1ZA, 2026-09/)).toBeTruthy();
    expect(await screen.findByText("Taxable value: portal ₹3200.00, books ₹3000.00")).toBeTruthy();
    expect(screen.getByText("Not reported by the supplier yet")).toBeTruthy();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect((post[1] as RequestInit).body).toBeInstanceOf(FormData);

    fireEvent.click(screen.getByRole("button", { name: "Matched (1)" }));
    await waitFor(() => expect(screen.queryByText("Not reported by the supplier yet")).toBeNull());
    expect(screen.getByText("sgt-1")).toBeTruthy();
  });

  it("shows the server's message when the file is refused", async () => {
    mockApi({
      ...common,
      "GET /gst/inward-statements": () => ({ status: 200, body: [] }),
      "POST /gst/inward-statements": () => ({ status: 400, body: { statusCode: 400, message: "The statement is for GSTIN 27AAACR1234A1Z3, which is not one of this company’s registrations" } }),
    });
    render(
      <AuthProvider>
        <InputCreditMatching />
      </AuthProvider>,
    );
    await screen.findByText("No statement has been uploaded for this GSTIN yet.");
    fireEvent.change(screen.getByLabelText("GSTR-2B JSON file"), { target: { files: [new File(["{}"], "x.json")] } });
    expect(await screen.findByText(/not one of this company’s registrations/)).toBeTruthy();
  });
});
