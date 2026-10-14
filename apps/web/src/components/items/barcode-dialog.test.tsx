// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ItemDto } from "@/lib/types";
import { BarcodeDialog } from "./barcode-dialog";

const item: ItemDto = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "RICE-5",
  name: "Rice 5 kg",
  description: null,
  hasImage: false,
  itemGroup: { id: "g1", code: "RICE", name: "Rice" },
  brand: null,
  baseUnit: { id: "22222222-2222-4222-8222-222222222222", code: "PCS", name: "Piece", allowsFractions: false },
  hsnCode: null,
  mrp: null,
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
  units: [
    { unitId: "22222222-2222-4222-8222-222222222222", code: "PCS", name: "Piece", allowsFractions: false, factor: "1", mrp: null },
    { unitId: "33333333-3333-4333-8333-333333333333", code: "BOX", name: "Box", allowsFractions: false, factor: "12", mrp: null },
  ],
  barcodes: [],
  variantAttributes: [],
  variantValues: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

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
});

describe("BarcodeDialog", () => {
  it("refuses a wrong check digit without calling the API", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BarcodeDialog item={item} open onClose={() => {}} onSaved={() => {}} />);

    // 8901234567890 is a valid EAN-13; 8901234567891 has the wrong check digit.
    fireEvent.change(screen.getByLabelText(/^Barcode/), { target: { value: "8901234567891" } });
    // Guessing falls back to "other" for an invalid code, so pick EAN-13 as the scanner would say.
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "EAN13" } });
    fireEvent.click(screen.getByRole("button", { name: "Add barcode" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Wrong check digit (expected 0)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("guesses EAN-13 for a valid 13-digit code and posts it with the chosen unit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "b1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<BarcodeDialog item={item} open onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/^Barcode/), { target: { value: "8901234567890" } });
    expect((screen.getByLabelText(/^Type/) as HTMLSelectElement).value).toBe("EAN13");
    fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: "33333333-3333-4333-8333-333333333333" } });
    fireEvent.click(screen.getByRole("button", { name: "Add barcode" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/items\/11111111-1111-4111-8111-111111111111\/barcodes$/);
    expect(JSON.parse(String(init.body))).toEqual({ code: "8901234567890", type: "EAN13", unitId: "33333333-3333-4333-8333-333333333333" });
  });
});
