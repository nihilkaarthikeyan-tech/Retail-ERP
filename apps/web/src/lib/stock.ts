// Copyright (c) 2026, Rademics. All rights reserved.
// Helpers shared by the inventory (module 4) screens.
"use client";

import { useSyncExternalStore } from "react";
import { businessDate, type CurrentUser, Decimal, hasPermission } from "shared";
import type { StockDocKindDto, StockDocStatus, StockLocationDto, StoreRef } from "./types";

export const KIND_LABELS: Record<StockDocKindDto, string> = {
  stock_in: "Stock in",
  stock_out: "Write-off",
  move: "Move within store",
  transfer_send: "Transfer (sent)",
  transfer_receive: "Transfer (received)",
  count: "Stock count",
};

export const REASON_LABELS: Record<string, string> = {
  opening: "Opening stock",
  found: "Stock found",
  free_goods: "Free goods",
  other_in: "Other (in)",
  damage: "Damaged",
  expiry: "Expired",
  theft_loss: "Theft or loss",
  sample: "Samples",
  shop_use: "Shop use",
  other_out: "Other (out)",
  normal: "Normal count",
};

export const STATUS_LABELS: Record<StockDocStatus, string> = {
  draft: "Draft",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

export const LOCATION_KIND_LABELS: Record<string, string> = {
  folder: "Folder",
  shelf: "Shelf",
  transit: "Transit",
  rejected: "Rejected",
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return REASON_LABELS[reason] ?? reason;
}

/** Which right drafts a kind of document (matches the API). */
export function canDraftKind(user: CurrentUser | null, kind: StockDocKindDto): boolean {
  if (kind === "move" || kind === "transfer_send" || kind === "transfer_receive") return hasPermission(user, "stock.move");
  return hasPermission(user, "stock.count");
}

/** Which right finalises (and cancels a finalised) document of a kind (matches the API). */
export function canFinaliseKind(user: CurrentUser | null, kind: StockDocKindDto): boolean {
  if (kind === "move" || kind === "transfer_send" || kind === "transfer_receive") return hasPermission(user, "stock.move");
  return hasPermission(user, "stock.adjust_finalise");
}

/** The stores the user can see, taken from their stock locations (transit has none). */
export function storesFromLocations(locations: StockLocationDto[]): StoreRef[] {
  const seen = new Map<string, StoreRef>();
  for (const l of locations) {
    if (l.store && !seen.has(l.store.id)) seen.set(l.store.id, l.store);
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Locations that can hold stock in one store: never folders, never transit, active only. */
export function stockLocationsOf(locations: StockLocationDto[], storeId: string): StockLocationDto[] {
  return locations.filter((l) => l.active && l.kind !== "folder" && l.kind !== "transit" && l.store?.id === storeId);
}

/** The user's default store if it is in the list, otherwise the first one. */
export function defaultStoreId(user: CurrentUser | null, stores: StoreRef[]): string {
  const preferred = user?.stores.find((s) => s.isDefault)?.id;
  if (preferred && stores.some((s) => s.id === preferred)) return preferred;
  return stores[0]?.id ?? "";
}

export function locationLabel(l: { name?: string; code?: string; store?: StoreRef | string | null } | null | undefined): string {
  if (!l) return "—";
  const store = typeof l.store === "string" ? l.store : l.store?.code;
  const name = l.name ?? l.code ?? "—";
  return store ? `${store} · ${name}` : name;
}

/** A decimal string without trailing zeros, for quantities ("12.000" → "12"). */
export function showQuantity(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  try {
    return new Decimal(value).toString();
  } catch {
    return value;
  }
}

/** True when the decimal string is below zero. */
export function isNegative(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new Decimal(value).isNegative() && !new Decimal(value).isZero();
  } catch {
    return false;
  }
}

/** Lines of a textarea, trimmed, blanks dropped (serial numbers). */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "HH:MM" Indian time of an instant (for showing when a document was posted). */
export function indianTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 330 * 60_000).toISOString().slice(11, 16);
}

const noop = () => () => {};

/**
 * Today's Indian business date (rule 15), read in the browser after hydration.
 * Empty while prerendering, so no clock is read on the server.
 */
export function useBusinessToday(): string {
  return useSyncExternalStore(noop, () => businessDate(), () => "");
}
