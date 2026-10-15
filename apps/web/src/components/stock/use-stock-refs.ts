// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { hasPermission } from "shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { storesFromLocations } from "@/lib/stock";
import type { StockLocationDto, StoreDto, StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/** The stock locations the user may see (their stores plus the company's transit). */
export function useStockLocations() {
  return useLoad(() => api.get<StockLocationDto[]>("/stock/locations"));
}

/**
 * Every active store of the company, for choosing where a transfer goes.
 * Needs stores.view; without it only the user's own stores are known.
 */
export function useCompanyStores(locations: StockLocationDto[] | null) {
  const { user } = useAuth();
  const canList = hasPermission(user, "stores.view");
  const all = useLoad<StoreDto[] | null>(() => (canList ? api.get<StoreDto[]>("/stores") : Promise.resolve(null)), [canList]);
  const own = storesFromLocations(locations ?? []);
  const stores: StoreRef[] = all.data ? all.data.filter((s) => s.active).map((s) => ({ id: s.id, code: s.code, name: s.name })) : own;
  return { stores, loading: all.loading, limited: !canList };
}
