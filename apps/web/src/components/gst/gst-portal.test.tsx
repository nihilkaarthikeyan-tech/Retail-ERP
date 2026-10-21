// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { encodeQr, qrSvgPath } from "shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrintDocument } from "@/components/documents/print-document";
import type { PrintDocumentDto } from "@/lib/documents";
import type { EInvoiceList, EWayList, EWayNeeded } from "@/lib/gst-portal";
import { indianDateTime, stateName } from "@/lib/gst-portal";
import { visibleMenu } from "@/lib/menu";
import { EInvoicesScreen } from "./e-invoices-screen";
import { EWayBillsScreen } from "./e-way-bills-screen";

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const ok = (body: unknown) => () => ({ status: 200, body });

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
  vi.restoreAllMocks();
});

const IRN = "a1".repeat(32);

const einvoices: EInvoiceList = {
  applies: true,
  thirtyDayLimit: true,
  counts: { waiting: 1, registered: 1, failed: 0, cancelled: 0, near_limit: 1 },
  rows: [
    {
      id: "e1",
      documentType: "pos_bill",
      documentId: "b1",
      documentNumber: "T1-2627-000001",
      documentKind: "Invoice",
      documentDate: "2026-10-01",
      store: "MAIN",
      buyerName: "Kaveri Traders",
      buyerGstin: "29AABCK1234A1Z5",
      total: "1050.00",
      billCancelled: false,
      status: "waiting",
      irn: null,
      ackNumber: null,
      ackDate: null,
      error: null,
      exportedAt: null,
      registeredAt: null,
      cancelledAt: null,
      lastDay: "2026-10-31",
      nearLimit: true,
      canCancel: false,
    },
    {
      id: "e2",
      documentType: "pos_bill",
      documentId: "b2",
      documentNumber: "T1-2627-000002",
      documentKind: "Invoice",
      documentDate: "2026-10-17",
      store: "MAIN",
      buyerName: "Kaveri Traders",
      buyerGstin: "29AABCK1234A1Z5",
      total: "2100.00",
      billCancelled: false,
      status: "registered",
      irn: IRN,
      ackNumber: "112610000000123",
      ackDate: "2026-10-17T09:48:00.000Z",
      error: null,
      exportedAt: "2026-10-17T09:00:00.000Z",
      registeredAt: "2026-10-17T09:48:00.000Z",
      cancelledAt: null,
      lastDay: "2026-11-16",
      nearLimit: false,
      canCancel: false,
    },
  ],
};

describe("E-invoices screen", () => {
  it("lists waiting and registered invoices, flags the 30-day limit, and exports the portal file", async () => {
    const created: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      created.push("blob");
      return "blob:x";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetch = mockApi({
      "GET /gst/e-invoices": ok(einvoices),
      "POST /gst/e-invoices/export": ok({ fileName: "e-invoices-33AAACR1234A1ZV-2026-10-18.json", content: "[]", count: 1, skipped: [{ id: "e9", documentNumber: "MAIN-T1-2026-27-000009", problems: ["The document number must be 1 to 16 characters for the portal"] }] }),
    });
    render(<EInvoicesScreen />);
    expect(await screen.findByText("T1-2627-000001")).toBeTruthy();
    expect(screen.getByText("Register by 31 Oct 2026")).toBeTruthy();
    expect(screen.getByText(IRN)).toBeTruthy();
    // Registered more than 24 hours ago: only a credit note can correct it.
    expect(screen.getByText(/Over 24 hours: correct it with a credit note/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Choose T1-2627-000001"));
    fireEvent.click(screen.getByRole("button", { name: "Export 1 chosen for the portal" }));
    expect(await screen.findByText(/1 e-invoice saved to e-invoices-33AAACR1234A1ZV-2026-10-18.json/)).toBeTruthy();
    expect(screen.getByText(/MAIN-T1-2026-27-000009: The document number must be 1 to 16 characters/)).toBeTruthy();
    const call = fetch.mock.calls.find(([u, i]) => String(u).endsWith("/gst/e-invoices/export") && i?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ ids: ["e1"] });
    expect(created).toHaveLength(1);
  });

  it("imports the portal’s answer and reports what matched", async () => {
    mockApi({
      "GET /gst/e-invoices": ok(einvoices),
      "POST /gst/e-invoices/import": ok({ registered: 1, failed: 0, cancelled: 0, unchanged: 0, unmatched: ["X-1"], problems: [] }),
    });
    render(<EInvoicesScreen />);
    await screen.findByText("T1-2627-000001");
    const input = screen.getByLabelText("Portal answer file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["[]"], "answer.json", { type: "application/json" })] } });
    expect(await screen.findByText(/Registered 1, failed 0/)).toBeTruthy();
    expect(screen.getByText("Not found here: X-1")).toBeTruthy();
  });
});

const ewayList: EWayList = {
  counts: { draft: 1, generated: 0, expiring: 0 },
  rows: [
    {
      id: "w1",
      documentType: "stock_document",
      documentId: "s1",
      documentNumber: "TS-2627-000001",
      documentKind: "Transfer",
      documentDate: "2026-10-18",
      fromState: "33",
      toState: "29",
      to: "Rademics Bengaluru, Bengaluru",
      value: "63000.00",
      distanceKm: 450,
      validityDays: 3,
      transporterId: null,
      transporterName: null,
      vehicleNo: "TN01AB1234",
      status: "draft",
      number: null,
      generatedAt: null,
      validUntil: null,
      expiring: false,
      canCancel: true,
      error: null,
    },
  ],
};
const needed: EWayNeeded[] = [{ documentType: "pos_bill", documentId: "b5", number: "T1-2627-000005", date: "2026-10-18", value: "75000.00", fromState: "33", toState: "29", limit: "50000.00" }];

describe("E-way bills screen", () => {
  it("shows what needs one, makes a draft with the validity worked out from the distance, and records the number", async () => {
    const fetch = mockApi({
      "GET /gst/e-way-bills": ok(ewayList),
      "GET /gst/e-way-bills/needed": ok(needed),
      "POST /gst/e-way-bills": () => ({ status: 201, body: {} }),
      "POST /gst/e-way-bills/w1/generated": ok({}),
    });
    render(<EWayBillsScreen />);
    expect(await screen.findByText("T1-2627-000005")).toBeTruthy();
    expect(await screen.findByText("TS-2627-000001")).toBeTruthy();
    expect(screen.getByText("450 km · 3 days")).toBeTruthy();
    expect(screen.getAllByText("Tamil Nadu (33) → Karnataka (29)").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Make e-way bill" }));
    const dialog = screen.getByRole("dialog", { name: "Make an e-way bill" });
    fireEvent.change(within(dialog).getByLabelText("Approximate distance (km)"), { target: { value: "450" } });
    expect(within(dialog).getByText("Valid for 3 days from when it is made")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    expect(await within(dialog).findByText("Give the vehicle number or the transporter id.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Vehicle number"), { target: { value: "TN01AB1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => String(u).endsWith("/gst/e-way-bills") && i?.method === "POST")).toBe(true));
    const draft = fetch.mock.calls.find(([u, i]) => String(u).endsWith("/gst/e-way-bills") && i?.method === "POST");
    expect(JSON.parse(String(draft?.[1]?.body))).toMatchObject({ documentType: "pos_bill", documentId: "b5", distanceKm: "450", vehicleNo: "TN01AB1234" });

    fireEvent.click(screen.getByRole("button", { name: "Enter number" }));
    const numberDialog = screen.getByRole("dialog", { name: "Enter the e-way bill number" });
    fireEvent.change(within(numberDialog).getByLabelText("E-way bill number (12 digits)"), { target: { value: "123456789012" } });
    fireEvent.change(within(numberDialog).getByLabelText("Made on (leave empty for now)"), { target: { value: "2026-10-18T10:30" } });
    fireEvent.click(within(numberDialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).endsWith("/gst/e-way-bills/w1/generated"))).toBe(true));
    const made = fetch.mock.calls.find(([u]) => String(u).endsWith("/gst/e-way-bills/w1/generated"));
    expect(JSON.parse(String(made?.[1]?.body))).toEqual({ number: "123456789012", generatedAt: "2026-10-18T10:30:00+05:30" });
  });
});

describe("prints and menu", () => {
  const base: PrintDocumentDto = {
    kind: "pos_bill",
    title: "Tax invoice",
    number: "T1-2627-000001",
    date: "2026-10-18",
    mark: null,
    paper: "A4",
    letterhead: { name: "Rademics", legalName: "Rademics Retail Pvt Ltd", storeName: null, address: [], gstin: "33AAACR1234A1ZV", phone: null, email: null, showLogo: false },
    party: null,
    details: [["E-invoice", "Not yet registered"]],
    columns: [{ key: "no", label: "#" }],
    lines: [{ no: "1" }],
    totals: [],
    amountInWords: null,
    terms: [],
    signatures: [],
    printedAt: "2026-10-18T08:30:00.000Z",
  };

  it("prints the 'not yet registered' notice, then the signed QR code once registered", () => {
    const { unmount } = render(<PrintDocument doc={{ ...base, notice: "E-invoice not yet registered on the government portal" }} />);
    expect(screen.getByRole("note", { name: "Notice" }).textContent).toMatch(/not yet registered/);
    expect(screen.queryByRole("img", { name: "e-invoice QR code" })).toBeNull();
    unmount();
    const code = encodeQr("eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiIn0.c2ln");
    render(<PrintDocument doc={{ ...base, details: [["IRN", IRN]], qr: { label: "e-invoice QR code", path: qrSvgPath(code), size: code.size } }} />);
    const qr = screen.getByRole("img", { name: "e-invoice QR code" });
    expect(qr.getAttribute("viewBox")).toBe(`-4 -4 ${code.size + 8} ${code.size + 8}`);
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(qrSvgPath(code));
    expect(screen.queryByRole("note", { name: "Notice" })).toBeNull();
  });

  it("shows the menu entries only with the rights", () => {
    const user = (permissions: string[]) => ({ id: "u", firstName: "A", lastName: null, email: "a@b.c", isOwnerAdmin: false, permissions, allStores: true, stores: [], mustChangePassword: false, roles: [] });
    const hrefs = (p: string[]) => visibleMenu(user(p) as never).map((m) => m.href);
    expect(hrefs(["einvoice.manage"])).toContain("/gst/e-invoices");
    expect(hrefs(["einvoice.manage"])).not.toContain("/gst/e-way-bills");
    expect(hrefs(["eway.manage"])).toContain("/gst/e-way-bills");
    expect(hrefs(["pos.sell"])).not.toContain("/gst/e-invoices");
  });

  it("formats states and Indian date-times for the API", () => {
    expect(stateName("29")).toBe("Karnataka (29)");
    expect(indianDateTime("2026-10-18T10:30")).toBe("2026-10-18T10:30:00+05:30");
    expect(indianDateTime("")).toBeUndefined();
  });
});
