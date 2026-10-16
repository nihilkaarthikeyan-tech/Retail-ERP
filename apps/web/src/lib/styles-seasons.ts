// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 (owner decision of 16 October 2026): seasons, markdowns, size × colour
// grids and season sell-through, as the API returns them.
import { type GridVariant, variantGrid } from "shared";
import type { AttributeDto, ItemDto } from "./types";

export interface SeasonDto {
  id: string;
  code: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  /** Items and variants carrying it (GET /seasons only). */
  itemCount?: number;
}

export interface MarkdownLineDto {
  itemId: string;
  code: string;
  name: string;
  mrp: string | null;
  oldPrice: string | null;
  newPrice: string | null;
  cappedAtMrp?: boolean;
  skipped?: string | null;
}

export interface MarkdownPreviewDto {
  priceList: { id: string; code: string; name: string };
  items: number;
  toChange: number;
  skipped: number;
  cappedAtMrp: number;
  lines: MarkdownLineDto[];
}

export interface MarkdownDto {
  id: string;
  priceList: { id: string; code: string; name: string } | null;
  rule: "percent" | "price";
  value: string;
  startDate: string;
  endDate: string | null;
  status: "upcoming" | "running" | "ended";
  itemCount: number;
  remark: string | null;
  createdAt: string;
  createdBy: string | null;
  lines?: MarkdownLineDto[];
}

export interface StyleGridCell {
  itemId: string;
  code: string;
  quantity: string;
}

export interface StyleStockGridDto {
  style: { id: string; code: string; name: string };
  across: { attributes: string[]; values: string[] };
  down: { attributes: string[]; values: (string | null)[] };
  stores: {
    store: { id: string; code: string; name: string };
    rows: { label: string | null; cells: (StyleGridCell | null)[]; total: string }[];
    columnTotals: string[];
    total: string;
  }[];
  total: string;
}

export interface SellThroughRow {
  key: string;
  code: string | null;
  name: string;
  bought: string;
  sold: string;
  inStock: string;
  percentSold: string | null;
}

export interface SellThroughDto {
  season: { id: string; code: string; name: string } | null;
  groupBy: "season" | "style" | "group" | "item";
  workedOutAt: string;
  rows: SellThroughRow[];
  totals: Omit<SellThroughRow, "key" | "code" | "name">;
}

/** A style's variants as GridVariant rows (from GET /items/:id/variants). */
export function gridVariants(variants: ItemDto[]): (GridVariant & { item: ItemDto })[] {
  return variants.map((v) => ({ id: v.id, item: v, values: v.variantValues.map((x) => ({ attributeId: x.attribute.id, value: x.value })) }));
}

/** The size × colour layout of a style: its last attribute across, the others down, in each attribute's list order. */
export function styleLayout(style: Pick<ItemDto, "variantAttributes">, variants: ItemDto[], attributes: AttributeDto[]) {
  const order = Object.fromEntries(attributes.map((a) => [a.id, a.values.map((v) => v.value)]));
  return variantGrid(
    style.variantAttributes.map((a) => a.id),
    gridVariants(variants),
    order,
  );
}
