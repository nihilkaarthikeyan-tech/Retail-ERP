// Copyright (c) 2026, Rademics. All rights reserved.
// Scenario 11.15 (plan 11 C2): typing 2, 3, 3, 2 under S, M, L, XL for Red
// on a goods receipt adds 4 lines, one per variant, with those quantities.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttributeDto, ItemDto } from "@/lib/types";
import { lineWithoutOrder } from "./receipts-lines";
import { type GridLine, SizeColourGrid } from "./size-colour-grid";

const PCS = "22222222-2222-4222-8222-222222222222";
const COLOUR = "a1111111-1111-4111-8111-111111111111";
const SIZE = "a2222222-2222-4222-8222-222222222222";
const SIZES = ["S", "M", "L", "XL"];

function item(over: Partial<ItemDto>): ItemDto {
  return {
    id: "",
    code: "",
    name: "",
    description: null,
    hasImage: false,
    itemGroup: { id: "g1", code: "MENS", name: "Menswear" },
    brand: null,
    baseUnit: { id: PCS, code: "PCS", name: "Piece", allowsFractions: false },
    hsnCode: "6205",
    mrp: "999",
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
    units: [{ unitId: PCS, code: "PCS", name: "Piece", allowsFractions: false, factor: "1", mrp: null }],
    barcodes: [],
    variantAttributes: [],
    variantValues: [],
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
    ...over,
  };
}

const style = item({
  id: "s0000000-0000-4000-8000-000000000000",
  code: "SHIRT",
  name: "Oxford shirt",
  isParentStyle: true,
  variantCount: 7,
  variantAttributes: [
    { id: COLOUR, code: "COLOUR", name: "Colour" },
    { id: SIZE, code: "SIZE", name: "Size" },
  ],
});

const variant = (colour: string, short: string, size: string, n: number, over: Partial<ItemDto> = {}) =>
  item({
    id: `v${n}000000-0000-4000-8000-000000000000`,
    code: `SHIRT-${short}-${size}`,
    name: `Oxford shirt ${colour} ${size}`,
    parent: { id: style.id, code: "SHIRT", name: "Oxford shirt" },
    variantValues: [
      { attribute: { id: COLOUR, code: "COLOUR", name: "Colour" }, value: colour, shortCode: short },
      { attribute: { id: SIZE, code: "SIZE", name: "Size" }, value: size, shortCode: size },
    ],
    ...over,
  });

// Returned in code order, as the API does (L before M before S); the grid puts them in list order.
const variants = [
  ...["L", "M", "S", "XL"].map((s, i) => variant("Red", "RED", s, i + 1)),
  variant("Blue", "BLU", "M", 5),
  variant("Blue", "BLU", "S", 6, { canBuy: false }),
  variant("Blue", "BLU", "L", 7),
];

const attributes: AttributeDto[] = [
  { id: COLOUR, code: "COLOUR", name: "Colour", kind: "list", rangeStart: null, rangeEnd: null, rangeStep: null, active: true, values: ["Red", "Blue"].map((v, i) => ({ id: `c${i}`, attributeId: COLOUR, value: v, shortCode: v.toUpperCase(), sortOrder: i })) },
  { id: SIZE, code: "SIZE", name: "Size", kind: "list", rangeStart: null, rangeEnd: null, rangeStep: null, active: true, values: SIZES.map((v, i) => ({ id: `z${i}`, attributeId: SIZE, value: v, shortCode: v, sortOrder: i })) },
];

function mockApi() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/items") return new Response(JSON.stringify({ rows: [style], total: 1, page: 1, pageSize: 20 }), { status: 200 });
    if (url.pathname === `/items/${style.id}/variants`) return new Response(JSON.stringify(variants), { status: 200 });
    if (url.pathname === "/catalogue/attributes") return new Response(JSON.stringify(attributes), { status: 200 });
    return new Response(JSON.stringify({ statusCode: 404, message: "No route" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openStyle() {
  const fetchMock = mockApi();
  const onAdd = vi.fn<(lines: GridLine[]) => void>();
  render(<SizeColourGrid onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("button", { name: "Add by size and colour" }));
  fireEvent.change(screen.getByLabelText("Style"), { target: { value: "oxford" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  fireEvent.click(await screen.findByRole("button", { name: /Oxford shirt/ }));
  await screen.findByText("Quantities in PCS.", { exact: false });
  return { onAdd, fetchMock };
}

describe("SizeColourGrid", () => {
  it("shows sizes across and colours down, in list order, only for styles", async () => {
    const { fetchMock } = await openStyle();
    const search = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname === "/items")!;
    expect(search.searchParams.get("kind")).toBe("style");
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Colour", "S", "M", "L", "XL"]);
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Red", "Blue"]);
    // Blue XL does not exist; Blue S cannot be bought.
    expect(screen.queryByLabelText("Quantity of Blue XL")).toBeNull();
    expect(screen.queryByLabelText("Quantity of Blue S")).toBeNull();
    expect(screen.getByLabelText("Quantity of Blue M")).toBeTruthy();
  });

  it("11.15: 2, 3, 3, 2 under S, M, L, XL for Red adds 4 lines with those quantities", async () => {
    const { onAdd } = await openStyle();
    ["2", "3", "3", "2"].forEach((q, i) => fireEvent.change(screen.getByLabelText(`Quantity of Red ${SIZES[i]}`), { target: { value: q } }));
    expect(screen.getByText("10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add the lines" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const lines = onAdd.mock.calls[0][0];
    expect(lines.map((l) => [l.item.code, l.quantity]).sort()).toEqual([
      ["SHIRT-RED-L", "3"],
      ["SHIRT-RED-M", "3"],
      ["SHIRT-RED-S", "2"],
      ["SHIRT-RED-XL", "2"],
    ]);
    // On a goods receipt each becomes an ordinary line without an order.
    const receiptLines = lines.map((l) => ({ ...lineWithoutOrder(l.item, null), received: l.quantity }));
    expect(receiptLines.map((l) => [l.item.code, l.unitId, l.received])).toContainEqual(["SHIRT-RED-M", PCS, "3"]);
    expect(screen.queryByText("Quantities in PCS.", { exact: false })).toBeNull();
  });

  it("refuses part pieces and an empty grid", async () => {
    const { onAdd } = await openStyle();
    fireEvent.click(screen.getByRole("button", { name: "Add the lines" }));
    expect(await screen.findByText("Type a quantity under at least one size.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Quantity of Red M"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the lines" }));
    expect(await screen.findByText('"1.5": whole pieces only')).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
