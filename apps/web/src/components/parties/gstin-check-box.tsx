// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 15 (owner, 28 October 2026): "Check with GST network" under a GSTIN, and what the last
// check said. The answer is a help, never a block: the record can always be saved.
"use client";

import { useState } from "react";
import { isValidGstin } from "shared";
import { Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";
import type { SavedGstinCheck } from "@/lib/types";

export type { SavedGstinCheck };

export interface GstinFactsDto {
  status: string;
  legalName: string | null;
  tradeName: string | null;
  stateCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  cancelledOn: string | null;
}

export interface GstinCheckResultDto {
  gstin: string;
  status: "active" | "cancelled" | "suspended" | "inactive" | "not_found" | "unavailable" | "off";
  facts: GstinFactsDto | null;
  checkedAt: string | null;
  message: string;
}

const BAD = new Set(["cancelled", "suspended", "inactive", "not_found"]);

/** The address in one line; the GST network often repeats the locality and city, so each part appears once. */
export function addressText(f: Pick<GstinFactsDto, "addressLine1" | "addressLine2" | "city" | "pincode">): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const piece of [f.addressLine1, f.addressLine2, f.city, f.pincode].filter(Boolean).flatMap((s) => s!.split(","))) {
    const p = piece.trim();
    if (p && !seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      parts.push(p);
    }
  }
  return parts.join(", ");
}

const SAVED_WORDS: Record<string, string> = {
  active: "Active",
  cancelled: "Cancelled",
  suspended: "Suspended",
  inactive: "Not active",
  not_found: "Not found",
};

export function GstinCheckBox({ gstin, saved, onUseDetails, disabled }: { gstin: string; saved?: SavedGstinCheck | null; onUseDetails?: (facts: GstinFactsDto) => void; disabled?: boolean }) {
  const [result, setResult] = useState<GstinCheckResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = gstin.trim().toUpperCase();
  const complete = code.length === 15 && isValidGstin(code);
  const shown = result && result.gstin === code ? result : null;

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<GstinCheckResultDto>("/gstin/check", { gstin: code }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!code) return null;
  const facts = shown?.facts ?? null;
  return (
    <div className="gstin-check" aria-live="polite">
      {saved && !shown ? (
        <p className={BAD.has(saved.status) ? "field-warning" : "field-hint"}>
          GST network: <strong>{SAVED_WORDS[saved.status] ?? saved.status}</strong>
          {saved.status === "cancelled" && saved.cancelledOn ? ` since ${formatDate(saved.cancelledOn)}` : ""}
          {saved.legalName ? `, ${saved.legalName}` : ""}
          {saved.checkedAt ? ` (checked ${formatDate(todayIso(new Date(saved.checkedAt)))})` : ""}
        </p>
      ) : null}
      {complete && !disabled ? (
        <Button size="small" onClick={() => void check()} busy={busy}>
          {shown ? "Check again" : "Check with GST network"}
        </Button>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
      {shown ? (
        <div className={`gstin-check-result ${BAD.has(shown.status) ? "is-bad" : shown.status === "active" ? "is-good" : ""}`}>
          <p>{shown.message}</p>
          {facts && (facts.legalName || facts.tradeName) ? (
            <dl className="gstin-check-facts">
              {facts.legalName ? (
                <>
                  <dt>Legal name</dt>
                  <dd>{facts.legalName}</dd>
                </>
              ) : null}
              {facts.tradeName && facts.tradeName !== facts.legalName ? (
                <>
                  <dt>Trade name</dt>
                  <dd>{facts.tradeName}</dd>
                </>
              ) : null}
              {facts.addressLine1 || facts.city ? (
                <>
                  <dt>Address</dt>
                  <dd>{addressText(facts)}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {facts && onUseDetails && (facts.legalName || facts.tradeName) ? (
            <Button size="small" onClick={() => onUseDetails(facts)}>
              Use these details
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
