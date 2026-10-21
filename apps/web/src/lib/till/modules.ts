// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12: optional modules at the till. The map comes with the till's saved
// copy (the snapshot), so the till hides switched-off parts offline too. A
// copy saved before plan 12 has no map: everything stays on.
import type { ModuleKey } from "shared";
import type { DraftBill } from "./pricing";
import type { TillSnapshot } from "./types";

/** True unless the saved copy says the module is switched off. */
export function tillModuleOn(snapshot: Pick<TillSnapshot, "modules"> | null | undefined, key: ModuleKey): boolean {
  return snapshot?.modules?.[key] !== false;
}

/**
 * A bill started before "Salesperson" was switched off may still name one;
 * it is left off so the bill is not refused (the salesperson changes no amount).
 */
export function withoutSwitchedOff(draft: DraftBill, snapshot: Pick<TillSnapshot, "modules">): DraftBill {
  if (tillModuleOn(snapshot, "salesperson")) return draft;
  if (!draft.salesStaffId && !draft.lines.some((l) => l.salesStaffId)) return draft;
  return { ...draft, salesStaffId: null, lines: draft.lines.map((l) => (l.salesStaffId ? { ...l, salesStaffId: null } : l)) };
}
