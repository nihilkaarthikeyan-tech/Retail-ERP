// Copyright (c) 2026, Rademics. All rights reserved.
// GST on purchases on the web (plan 08 §3): the purchase tax register and
// input-credit matching against the GST portal's GSTR-2B statement.
import type { MatchRow, MatchStatus } from "shared";

export interface PurchaseTaxRowDto {
  billId: string;
  number: string;
  kind: "invoice" | "debit_note";
  supplierBillNo: string;
  supplierBillDate: string;
  postingDate: string;
  supplier: { id: string; code: string; name: string };
  supplierGstin: string | null;
  placeOfSupply: string | null;
  rates: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  creditClaimable: string;
  creditNotClaimable: string;
  reverseCharge: boolean;
  total: string;
}

export interface PurchaseTaxRegisterDto {
  gstin: string;
  gstRegistrationId: string;
  from: string;
  to: string;
  rows: PurchaseTaxRowDto[];
  totals: { taxable: string; cgst: string; sgst: string; igst: string; tax: string; creditClaimable: string; creditNotClaimable: string; reverseChargeTax: string; total: string };
}

export interface InwardStatementDto {
  id: string;
  gstRegistrationId: string;
  gstin: string | null;
  period: string;
  fileName: string;
  uploadedAt: string;
}

export interface MatchResultDto {
  upload: InwardStatementDto;
  summary: Record<MatchStatus, number>;
  rows: MatchRow[];
}

/** "2026-09" for the month containing a business date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The last few months and quarters to choose from, newest first. */
export function periodChoices(today: string, months = 12): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (let i = 0; i < months; i++) {
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${names[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  // Quarters of the current and the last financial year (Q1 = April–June).
  const fy = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const quarterNames = ["April–June", "July–September", "October–December", "January–March"];
  for (const year of [fy, fy - 1]) {
    for (let q = 4; q >= 1; q--) {
      const startYear = q === 4 ? year + 1 : year;
      const startMonth = [4, 7, 10, 1][q - 1];
      if (`${startYear}-${String(startMonth).padStart(2, "0")}` > today.slice(0, 7)) continue;
      out.push({ value: `${year}-Q${q}`, label: `Quarter ${q} of ${year}-${String((year + 1) % 100).padStart(2, "0")} (${quarterNames[q - 1]})` });
    }
  }
  return out;
}

/** Badge colour for a match status. */
export function matchTone(status: MatchStatus): "ok" | "warn" | "off" | "neutral" {
  if (status === "matched") return "ok";
  if (status === "value_difference") return "warn";
  return "off";
}
