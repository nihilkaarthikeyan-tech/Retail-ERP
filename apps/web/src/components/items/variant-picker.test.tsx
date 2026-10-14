// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttributeDto, ItemDto } from "@/lib/types";
import { VariantPicker } from "./variant-picker";

const SIZE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COLOUR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const attributes: AttributeDto[] = [
  {
    id: SIZE,
    code: "SIZE",
    name: "Size",
    kind: "list",
    rangeStart: null,
    rangeEnd: null,
    rangeStep: null,
    active: true,
    values: [
      { id: "s1", attributeId: SIZE, value: "Small", shortCode: "S", sortOrder: 0 },
      { id: "s2", attributeId: SIZE, value: "Medium", shortCode: "M", sortOrder: 1 },
      { id: "s3", attributeId: SIZE, value: "Large", shortCode: "L", sortOrder: 2 },
    ],
  },
  {
    id: COLOUR,
    code: "COLOUR",
    name: "Colour",
    kind: "list",
    rangeStart: null,
    rangeEnd: null,
    rangeStep: null,
    active: true,
    values: [
      { id: "c1", attributeId: COLOUR, value: "Red", shortCode: "RED", sortOrder: 0 },
      { id: "c2", attributeId: COLOUR, value: "Blue", shortCode: "BLU", sortOrder: 1 },
    ],
  },
];

const style: ItemDto = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "SHIRT",
  name: "Shirt",
  description: null,
  hasImage: false,
  itemGroup: { id: "g1", code: "SHIRTS", name: "Shirts" },
  brand: null,
  baseUnit: { id: "u1", code: "PCS", name: "Piece", allowsFractions: false },
  hsnCode: null,
  mrp: null,
  maxDiscountPercent: "0",
  isStockItem: true,
  canBuy: true,
  canSell: true,
  endDate: null,
  active: true,
  isParentStyle: true,
  parent: null,
  variantCount: 0,
  trackBatches: false,
  autoNumberBatches: true,
  shelfLifeDays: null,
  trackSerials: false,
  warrantyDays: null,
  units: [],
  barcodes: [],
  variantAttributes: [
    { id: SIZE, code: "SIZE", name: "Size" },
    { id: COLOUR, code: "COLOUR", name: "Colour" },
  ],
  variantValues: [],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VariantPicker", () => {
  it("counts the combinations as values are ticked and previews the codes", () => {
    render(<VariantPicker item={style} attributes={attributes} onCreated={() => {}} />);

    expect(screen.getByText("0 combinations", { selector: "strong" })).toBeTruthy();
    const button = screen.getByRole("button", { name: "Create variants" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Small (S)"));
    fireEvent.click(screen.getByLabelText("Medium (M)"));
    // One attribute still has nothing ticked: no combinations yet.
    expect(screen.getByText("0 combinations", { selector: "strong" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Red (RED)"));
    expect(screen.getByText("2 combinations", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/SHIRT-S-RED, SHIRT-M-RED/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Blue (BLU)"));
    expect(screen.getByText("4 combinations", { selector: "strong" })).toBeTruthy();
    expect(button.disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("Small (S)"));
    expect(screen.getByText("2 combinations", { selector: "strong" })).toBeTruthy();
  });

  it("posts the ticked values per attribute and reports what was created", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ created: [{ id: "v1" }], skippedExisting: 1 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<VariantPicker item={style} attributes={attributes} onCreated={onCreated} />);

    fireEvent.click(screen.getByLabelText("Large (L)"));
    fireEvent.click(screen.getByLabelText("Red (RED)"));
    fireEvent.click(screen.getByLabelText("Blue (BLU)"));
    fireEvent.click(screen.getByRole("button", { name: "Create variants" }));

    expect((await screen.findByRole("status")).textContent).toContain("1 variant created, 1 already existed and was skipped.");
    expect(onCreated).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/items\/11111111-1111-4111-8111-111111111111\/variants$/);
    expect(JSON.parse(String(init.body))).toEqual({ values: { [SIZE]: ["Large"], [COLOUR]: ["Red", "Blue"] } });
  });
});
