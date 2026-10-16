// Copyright (c) 2026, Rademics. All rights reserved.
// Showing rupees on the till: Indian digit grouping (1,23,456.00) done on the
// decimal string itself, never through floating point (rule 1).
import { Decimal, type DecimalInput } from "shared";

export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

/** "₹1,23,456.00"; minus amounts as "−₹120.00". */
export function rupees(value: DecimalInput | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return String(value);
  }
  const [int, frac] = d.abs().toFixed(2).split(".");
  return `${d.isNegative() && !d.isZero() ? "−" : ""}₹${groupIndian(int)}.${frac}`;
}

/** Quantities without trailing zeros: "2", "1.5". */
export function qty(value: DecimalInput): string {
  try {
    return new Decimal(value).toString();
  } catch {
    return String(value);
  }
}

/** Time of day in India, e.g. "10:42". */
export function timeIn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

/** Date and time in India for receipts. */
export function dateTimeIn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

/** True when the amount is a number other than zero (decimal comparison, no floats). */
export function nonZero(value: DecimalInput | null | undefined): boolean {
  try {
    return value !== null && value !== undefined && value !== "" && !new Decimal(value).isZero();
  } catch {
    return false;
  }
}
