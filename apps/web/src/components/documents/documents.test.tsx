// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { barcodeModules } from "shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import type { ImportPreviewDto, ImportStatusDto, LabelDataDto, PrintDocumentDto } from "@/lib/documents";
import { Barcode } from "./barcode";
import { ClearTrialDataDialog, GoLiveDateDialog } from "./go-live-screen";
import { ImportScreen } from "./import-screen";
import { LabelSheets } from "./label-view";
import { PrintDocument } from "./print-document";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const user = (permissions: string[], isOwnerAdmin = false) => ({
  id: "u1",
  firstName: "Asha",
  lastName: null,
  email: "asha@example.com",
  isOwnerAdmin,
  permissions,
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
});

type Route = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown };

/** Routes fetch calls by "METHOD /path" or by path alone. */
function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const match = Object.entries(routes).find(([key]) => key === `${method} ${url.pathname}`) ?? Object.entries(routes).find(([key]) => !key.includes(" ") && url.pathname === key);
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = match[1](url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (body: unknown) => () => ({ status: 200, body });

beforeAll(() => {
  // jsdom has no <dialog>.showModal.
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

// ---- The print layout ----

const DOC: PrintDocumentDto = {
  kind: "purchase_order",
  title: "Purchase order",
  number: "PO-MAIN-2026-27-00007",
  date: "2026-10-16",
  mark: "DRAFT",
  paper: "A4",
  letterhead: { name: "Rademics", legalName: "Rademics Retail Pvt Ltd", storeName: "Main Store", address: ["12 Anna Salai", "Chennai 600002"], gstin: "33AAACR1234A1ZV", phone: "044 2345 6789", email: null, showLogo: false },
  party: { label: "Supplier", name: "Metro Distributors", code: "SUP-000001", address: ["4 Industrial Estate"], gstin: "33AAACM1234B1ZQ", phone: "9800011122" },
  details: [
    ["Needed by", "2026-10-20"],
    ["Payment terms", "Net 30"],
  ],
  columns: [
    { key: "no", label: "#" },
    { key: "item", label: "Item" },
    { key: "quantity", label: "Quantity", align: "right" },
    { key: "total", label: "Amount", align: "right" },
  ],
  lines: [{ no: "1", item: "Basmati Rice 1 kg (ITM-000001)", quantity: "1000 PCS", total: "123450.25" }],
  totals: [
    ["Taxable value", "117571.67"],
    ["Total", "123450.25"],
  ],
  amountInWords: "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only",
  terms: ["Goods once received are checked within 24 hours."],
  signatures: ["Authorised signatory"],
  printedAt: "2026-10-16T08:30:00.000Z",
};

describe("PrintDocument", () => {
  it("shows the DRAFT watermark, the amount in words, and Indian amounts and dates", () => {
    render(<PrintDocument doc={DOC} />);
    expect(screen.getByRole("note", { name: "Marked DRAFT" }).textContent).toBe("DRAFT");
    expect(screen.getByText("Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only")).toBeTruthy();
    // Lines keep Indian grouping without the rupee sign; totals carry it.
    expect(screen.getByRole("cell", { name: "1,23,450.25" })).toBeTruthy();
    const totals = screen.getByRole("table", { name: "Totals" });
    expect(within(totals).getByText("₹1,23,450.25")).toBeTruthy();
    expect(within(totals).getByText("₹1,17,571.67")).toBeTruthy();
    expect(screen.getByText("16 Oct 2026")).toBeTruthy();
    expect(screen.getByText("20 Oct 2026")).toBeTruthy();
    expect(screen.getByText("PO-MAIN-2026-27-00007")).toBeTruthy();
    // The header row is a <thead>, which the print styles repeat on every page.
    expect(document.querySelector(".doc-lines thead th")?.textContent).toBe("#");
    expect(screen.getByText("Authorised signatory")).toBeTruthy();
    expect(screen.getByText(/Printed on 16 Oct 2026, 14:00/)).toBeTruthy();
  });

  it("has no mark on a finalised document and marks a cancelled one", () => {
    const { rerender } = render(<PrintDocument doc={{ ...DOC, mark: null }} />);
    expect(screen.queryByRole("note")).toBeNull();
    rerender(<PrintDocument doc={{ ...DOC, mark: "CANCELLED" }} />);
    expect(screen.getByRole("note", { name: "Marked CANCELLED" })).toBeTruthy();
  });
});

// ---- Barcodes and labels ----

describe("Barcode", () => {
  it("draws one bar for each run of 1s in the modules", () => {
    const { container } = render(<Barcode barcode={{ symbology: "CODE128", modules: "1101001110", text: "AB" }} />);
    const bars = container.querySelectorAll(".barcode-bar");
    expect(bars).toHaveLength(3);
    // Widths follow the runs: 2, 1 and 3 modules, after a 10-module quiet zone.
    expect([...bars].map((b) => [b.getAttribute("x"), b.getAttribute("width")])).toEqual([
      ["10", "2"],
      ["13", "1"],
      ["16", "3"],
    ]);
    expect(screen.getByRole("img", { name: "Barcode AB" })).toBeTruthy();
  });

  it("draws an EAN-13 with 30 bars, longer guard bars and its 13 digits", () => {
    const b = barcodeModules("8901234567890", "EAN13");
    const { container } = render(<Barcode barcode={b} />);
    const bars = [...container.querySelectorAll(".barcode-bar")];
    expect(bars).toHaveLength(30);
    const heights = bars.map((r) => Number(r.getAttribute("height")));
    const tall = Math.max(...heights);
    // Start, centre and end guards: two bars each.
    expect(heights.filter((h) => h === tall)).toHaveLength(6);
    expect([...container.querySelectorAll("text")].map((t) => t.textContent).join("")).toBe("8901234567890");
    // 11 modules of quiet zone on the left, 7 on the right.
    expect(container.querySelector("svg")?.getAttribute("viewBox")?.startsWith(`0 0 ${11 + 95 + 7} `)).toBe(true);
  });
});

describe("LabelSheets", () => {
  const label = { itemId: "i1", code: "ITM-000001", name: "Basmati Rice 1 kg", unit: "PCS", price: "110.00", mrp: "120.00", barcode: barcodeModules("8901234567890", "EAN13"), batch: "B1", expiry: "2027-04-30", packed: null, store: null };
  const template = { id: "t1", name: "Shelf", sizeKey: "a4-24", width: 63.5, height: 33.9, media: "sheet" as const, across: 3, down: 8, marginTop: 12.9, marginLeft: 7.2, gapX: 2.5, gapY: 0, fields: ["name" as const, "price" as const, "barcode" as const], fontSize: 8, isDefault: true };

  it("places labels on A4 sheets by the template's margins and gaps, showing only its fields", () => {
    const data: LabelDataDto = { template, labels: Array.from({ length: 26 }, () => label) };
    const { container } = render(<LabelSheets data={data} skip={1} />);
    // 1 empty space + 26 labels = 27 places: a full sheet of 24 and 3 on the next.
    expect(screen.getAllByRole("group")).toHaveLength(2);
    const slots = container.querySelectorAll(".label-sheet:first-child .label-slot");
    expect(slots).toHaveLength(24);
    expect(slots[0].classList.contains("label-slot-empty")).toBe(true);
    expect((slots[1] as HTMLElement).style.left).toBe(`${7.2 + 63.5 + 2.5}mm`);
    expect((slots[3] as HTMLElement).style.top).toBe(`${12.9 + 33.9}mm`);
    expect(screen.getAllByText("₹110.00")).toHaveLength(26);
    // MRP and expiry are not among the template's fields.
    expect(screen.queryByText(/MRP/)).toBeNull();
    expect(screen.queryByText(/Exp/)).toBeNull();
  });

  it("prints a roll one label per page", () => {
    const data: LabelDataDto = { template: { ...template, sizeKey: "roll-50x25", width: 50, height: 25, media: "roll", across: null, down: null, fields: ["name", "mrp", "expiry"] }, labels: [label, label] };
    const { container } = render(<LabelSheets data={data} />);
    expect(container.querySelectorAll(".label-roll-page")).toHaveLength(2);
    expect(screen.getAllByText("MRP ₹120.00")).toHaveLength(2);
    expect(screen.getAllByText("Exp 30 Apr 2027")).toHaveLength(2);
  });
});

// ---- Import ----

const JOB = "c0000000-0000-4000-8000-000000000001";
const FIELDS = [
  { key: "name", label: "Item name", type: "text", required: true },
  { key: "group", label: "Item group code", type: "code", required: true },
  { key: "mrp", label: "MRP", type: "number" },
];
const PREVIEW: ImportPreviewDto = {
  jobId: JOB,
  kind: "items",
  mode: "add",
  fileName: "items.csv",
  columns: [
    { heading: "Item name", field: "name", label: "Item name" },
    { heading: "Group", field: "group", label: "Item group code" },
    { heading: "MRP", field: "mrp", label: "MRP" },
    { heading: "Colour", field: null, label: null },
  ],
  unmatched: ["Colour"],
  missingRequired: [],
  rows: 3,
  ready: 2,
  problems: [{ rowNumber: 3, problems: ['MRP "abc" is not a number'] }],
  fields: FIELDS as ImportPreviewDto["fields"],
};
const JOB_BASE = { id: JOB, kind: "items" as const, kindLabel: "Items", mode: "add" as const, fileName: "items.csv", totalRows: 3, message: null, createdAt: "2026-10-16T08:00:00.000Z", startedAt: "2026-10-16T08:00:05.000Z", finishedAt: null };

describe("ImportScreen", () => {
  it("shows problems by row number, re-matches a column, runs, and offers the failed rows", async () => {
    const running: ImportStatusDto = { ...JOB_BASE, status: "running", added: 0, changed: 0, unchanged: 0, failed: 1, done: 1, failedRows: [] };
    const finished: ImportStatusDto = { ...JOB_BASE, status: "partly_done", added: 1, changed: 0, unchanged: 0, failed: 2, done: 3, finishedAt: "2026-10-16T08:00:09.000Z", failedRows: [
      { rowNumber: 3, message: 'MRP "abc" is not a number' },
      { rowNumber: 4, message: 'Item group "XYZ" was not found' },
    ] };
    const previews: string[] = [];
    const fn = mockApi({
      "/auth/me": ok(user(["import.masters", "catalogue.manage"])),
      "/imports/kinds": ok([{ kind: "items", label: "Items", fields: FIELDS, exportable: true }]),
      "/imports": ok([]),
      "POST /imports/preview": (_url, init) => {
        previews.push(String((init?.body as FormData).get("options")));
        return { status: 200, body: PREVIEW };
      },
      [`POST /imports/${JOB}/run`]: ok(running),
      [`/imports/${JOB}`]: ok(finished),
      [`/imports/${JOB}/failed-rows`]: () => ({ status: 200, body: "spreadsheet bytes" }),
    });
    render(
      <AuthProvider>
        <ImportScreen pollMs={5} />
      </AuthProvider>,
    );

    await screen.findByRole("option", { name: "Items" });
    expect(screen.getByText(/must stay as/)).toBeTruthy();
    const file = new File(["Item name,Group,MRP,Colour\n"], "items.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("The filled-in file"), { target: { files: [file] } });

    // The problems are listed by spreadsheet row number before anything is saved.
    expect(await screen.findByText("Row 3")).toBeTruthy();
    expect(screen.getByText('MRP "abc" is not a number')).toBeTruthy();
    expect(screen.getByText(/Not matched, so not used: Colour/)).toBeTruthy();
    expect(JSON.parse(previews[0])).toEqual({ kind: "items", mode: "add" });

    // Re-matching a column checks the file again with the new mapping.
    fireEvent.change(screen.getByLabelText("Read “Colour” as"), { target: { value: "mrp" } });
    await waitFor(() => expect(previews).toHaveLength(2));
    expect(JSON.parse(previews[1])).toEqual({ kind: "items", mode: "add", mapping: { Colour: "mrp" } });

    fireEvent.click(await screen.findByRole("button", { name: "Import 2 rows" }));
    const download = await screen.findByRole("button", { name: "Download the failed rows" });
    expect(screen.getByText("Partly done")).toBeTruthy();
    expect(screen.getByText('Item group "XYZ" was not found')).toBeTruthy();
    expect(screen.getByText("Row 4")).toBeTruthy();

    // The download asks the API for the failed rows of this import.
    URL.createObjectURL = vi.fn(() => "blob:failed");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(download);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fn.mock.calls.some((c) => String(c[0]).endsWith(`/imports/${JOB}/failed-rows`))).toBe(true);
  });

  it("keeps Import switched off while required columns are missing", async () => {
    mockApi({
      "/auth/me": ok(user(["import.masters"])),
      "/imports/kinds": ok([{ kind: "items", label: "Items", fields: FIELDS, exportable: true }]),
      "/imports": ok([]),
      "POST /imports/preview": ok({ ...PREVIEW, missingRequired: ["Item group code"], problems: [] }),
    });
    render(
      <AuthProvider>
        <ImportScreen />
      </AuthProvider>,
    );
    await screen.findByRole("option", { name: "Items" });
    fireEvent.change(screen.getByLabelText("The filled-in file"), { target: { files: [new File(["x"], "items.csv")] } });
    expect(await screen.findByText(/These columns are needed but were not found/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import 2 rows" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---- Going live ----

describe("Going live confirmations", () => {
  it("keeps Clear the trial data disabled until a reason is given and the company name matches", async () => {
    const fn = mockApi({ "POST /go-live/clear-trial-data": ok({ id: "c1", steps: [], note: "Open each till again." }) });
    const onCleared = vi.fn();
    render(<ClearTrialDataDialog companyName="Rademics Retail Pvt Ltd" onClose={vi.fn()} onCleared={onCleared} />);
    const button = screen.getByRole("button", { name: "Clear the trial data" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getByText("Kept")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Why are you clearing it?", { exact: false }), { target: { value: "End of the trial" } });
    fireEvent.change(screen.getByLabelText(/Type the company name/), { target: { value: "Rademics Retail" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the company name/), { target: { value: "  rademics retail pvt ltd " } });
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Why are you clearing it?", { exact: false }), { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    expect(fn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Why are you clearing it?", { exact: false }), { target: { value: "End of the trial" } });
    fireEvent.click(button);
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ reason: "End of the trial", confirmCompanyName: "rademics retail pvt ltd" });
  });

  it("warns that the go-live date is for good and waits for the company name", () => {
    render(<GoLiveDateDialog companyName="Rademics Retail Pvt Ltd" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("This can never be undone.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Record the go-live date" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the company name/), { target: { value: "Rademics Retail Pvt Ltd" } });
    expect(button.disabled).toBe(false);
  });
});
