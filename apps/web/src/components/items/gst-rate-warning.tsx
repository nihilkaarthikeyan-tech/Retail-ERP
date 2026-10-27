// Copyright (c) 2026, Rademics. All rights reserved.
// Launch check, 27 October 2026: an item whose HSN code has no GST rate could be saved
// without a word, and the cashier found out only at the till ("No GST rate is set for
// HSN 3304"), with the customer waiting. The item screen now says so at once.
"use client";

import Link from "next/link";
import { type GstRateRow, pickGstRate } from "shared";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

/** A note under the HSN box when the code is complete and no GST rate is set for it. */
export function GstRateWarning({ hsnCode }: { hsnCode: string }) {
  // People who may not see the rate list get nothing back, and so no note.
  const rates = useLoad(() => api.get<(GstRateRow & { effectiveFrom: string })[]>("/pos/gst-rates", { redirectOnUnauthorized: false }).catch(() => null), []);
  const code = hsnCode.trim();
  if (!/^\d{4}(\d{2}){0,2}$/.test(code) || !rates.data) return null;
  if (pickGstRate(rates.data, code, todayIso())) return null;
  return (
    <p className="field-warning" role="status">
      No GST rate is set for HSN {code} yet, so the till cannot sell this item. Add it under <Link href="/pos/gst-rates">Billing counter → GST rates</Link>.
    </p>
  );
}
