// Copyright (c) 2026, Rademics. All rights reserved.
// Small helpers shared by the customer and supplier screens.
import { GSTIN_RE, gstinStateCode, isStateCode, panFromGstin } from "shared";
import { ApiError } from "./api";
import type { DuplicateMobileBody, HoldType, PartyStatus, PaymentTermsPartDto, SupplierDto } from "./types";

export const STATUS_LABELS: Record<PartyStatus, string> = { active: "Active", blocked: "Blocked", off: "Switched off" };

export const HOLD_LABELS: Record<HoldType, string> = {
  none: "No hold",
  bills: "Orders and bills",
  payments: "Payments",
  all: "Orders, bills and payments",
};

export const DUE_BASIS_LABELS: Record<PaymentTermsPartDto["dueBasis"], string> = {
  days_after_date: "Days after the bill date",
  days_after_month_end: "Days after the end of the bill's month",
  months_then_month_end: "End of the month, N months later",
};

/** The state code the GSTIN's first two digits point to, or null while it is not a known state yet. */
export function stateFromGstin(gstin: string): string | null {
  const code = gstin.trim().slice(0, 2);
  return code.length === 2 && isStateCode(code) ? code : null;
}

/** The PAN inside a complete, format-valid GSTIN; null otherwise. */
export function panInGstin(gstin: string): string | null {
  const g = gstin.trim().toUpperCase();
  return GSTIN_RE.test(g) ? panFromGstin(g) : null;
}

/** The hold that still applies today (the API lifts a hold whose end date has passed). */
export function effectiveHold(supplier: Pick<SupplierDto, "holdType" | "holdUntil">, today: string): HoldType {
  if (supplier.holdType === "none") return "none";
  if (supplier.holdUntil && supplier.holdUntil < today) return "none";
  return supplier.holdType;
}

/** The duplicate-mobile answer (409 DUPLICATE_MOBILE), or null for any other error. */
export function duplicateMobile(err: unknown): DuplicateMobileBody | null {
  if (!(err instanceof ApiError) || err.code !== "DUPLICATE_MOBILE") return null;
  const body = err.body as Partial<DuplicateMobileBody> | null;
  return { message: err.message, code: "DUPLICATE_MOBILE", matches: Array.isArray(body?.matches) ? body.matches : [] };
}

/** One part described in words: "50% — 15 days after the bill date". */
export function describePart(part: Pick<PaymentTermsPartDto, "share" | "dueBasis" | "days" | "months">): string {
  const when =
    part.dueBasis === "days_after_date"
      ? part.days === 0
        ? "on the bill date"
        : `${part.days} day${part.days === 1 ? "" : "s"} after the bill date`
      : part.dueBasis === "days_after_month_end"
        ? `${part.days} day${part.days === 1 ? "" : "s"} after the month end`
        : `end of the month ${part.months} month${part.months === 1 ? "" : "s"} later`;
  return `${part.share}% ${when}`;
}

export { gstinStateCode };
