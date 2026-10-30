// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { api, query } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

/**
 * Audit 14: whether this supplier's goods into this store are inter-state (IGST), asked from the server,
 * which decides it the same way when the order or bill is saved. Same-state until the answer comes.
 */
export function useInterState(supplierId: string | null | undefined, storeId: string | null | undefined): boolean {
  const pos = useLoad(() => (supplierId ? api.get<{ interState: boolean }>(`/purchase/place-of-supply${query({ supplierId, storeId })}`) : Promise.resolve(null)), [supplierId, storeId]);
  return pos.data?.interState ?? false;
}
