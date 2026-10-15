// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { DUE_BASES, sharesProblem } from "shared";
import { Button, SelectInput, TextInput } from "@/components/ui";
import { DUE_BASIS_LABELS } from "@/lib/parties";
import type { DueBasis, PaymentTermsPartDto } from "@/lib/types";
import type { FieldErrors } from "@/lib/validation";

/** One part as typed: every number is kept as text until the form is sent. */
export interface PartValues {
  share: string;
  dueBasis: DueBasis;
  days: string;
  months: string;
  earlyDiscountPercent: string;
  earlyDiscountDays: string;
}

export const newPart = (share = "100"): PartValues => ({ share, dueBasis: "days_after_date", days: "0", months: "0", earlyDiscountPercent: "", earlyDiscountDays: "" });

export function partFromDto(p: PaymentTermsPartDto): PartValues {
  return {
    share: p.share,
    dueBasis: p.dueBasis,
    days: String(p.days),
    months: String(p.months),
    earlyDiscountPercent: p.earlyDiscountPercent ?? "",
    earlyDiscountDays: p.earlyDiscountDays == null ? "" : String(p.earlyDiscountDays),
  };
}

/** Whole number from text: empty → fallback, anything odd → NaN (zod reports it). */
function whole(text: string, fallback: number | null): number | null {
  const t = text.trim();
  if (t === "") return fallback;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** The parts as the API expects them. */
export function partsPayload(parts: PartValues[]) {
  return parts.map((p) => ({
    share: p.share.trim(),
    dueBasis: p.dueBasis,
    days: p.dueBasis === "months_then_month_end" ? 0 : (whole(p.days, 0) as number),
    months: p.dueBasis === "months_then_month_end" ? (whole(p.months, 0) as number) : 0,
    earlyDiscountPercent: p.earlyDiscountPercent.trim() === "" ? null : p.earlyDiscountPercent.trim(),
    earlyDiscountDays: whole(p.earlyDiscountDays, null),
  }));
}

/** The shares-total problem while every share is a number; null when they add up to 100. */
export function partsSharesProblem(parts: PartValues[]): string | null {
  if (parts.some((p) => p.share.trim() === "" || !/^\d+(\.\d+)?$/.test(p.share.trim()))) return null;
  return sharesProblem(parts.map((p) => ({ share: p.share.trim() })));
}

interface TermsPartsEditorProps {
  parts: PartValues[];
  onChange: (parts: PartValues[]) => void;
  /** Field errors keyed like "parts.0.share". */
  errors?: FieldErrors;
  disabled?: boolean;
}

/** Rows of share %, due basis, days/months and the optional early-payment discount; checks the shares total as you type. */
export function TermsPartsEditor({ parts, onChange, errors = {}, disabled }: TermsPartsEditorProps) {
  const update = (i: number, patch: Partial<PartValues>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const problem = partsSharesProblem(parts);

  return (
    <div>
      {parts.map((p, i) => (
        <fieldset key={i} disabled={disabled}>
          <legend>Part {i + 1}</legend>
          <div className="form-grid">
            <TextInput id={`part-${i}-share`} label="Share %" value={p.share} onChange={(e) => update(i, { share: e.target.value })} error={errors[`parts.${i}.share`]} inputMode="decimal" className="mono" />
            <SelectInput id={`part-${i}-basis`} label="Due" value={p.dueBasis} onChange={(e) => update(i, { dueBasis: e.target.value as DueBasis })} error={errors[`parts.${i}.dueBasis`]}>
              {DUE_BASES.map((b) => (
                <option key={b} value={b}>
                  {DUE_BASIS_LABELS[b]}
                </option>
              ))}
            </SelectInput>
            {p.dueBasis === "months_then_month_end" ? (
              <TextInput id={`part-${i}-months`} label="Months" value={p.months} onChange={(e) => update(i, { months: e.target.value })} error={errors[`parts.${i}.months`]} inputMode="numeric" className="mono" hint="0 = end of the bill's own month." />
            ) : (
              <TextInput id={`part-${i}-days`} label="Days" value={p.days} onChange={(e) => update(i, { days: e.target.value })} error={errors[`parts.${i}.days`]} inputMode="numeric" className="mono" hint="0 = due on the day." />
            )}
            <span />
            <TextInput id={`part-${i}-earlyPercent`} label="Early-payment discount %" value={p.earlyDiscountPercent} onChange={(e) => update(i, { earlyDiscountPercent: e.target.value })} error={errors[`parts.${i}.earlyDiscountPercent`]} inputMode="decimal" className="mono" hint="Optional." />
            <TextInput id={`part-${i}-earlyDays`} label="If paid within (days)" value={p.earlyDiscountDays} onChange={(e) => update(i, { earlyDiscountDays: e.target.value })} error={errors[`parts.${i}.earlyDiscountDays`]} inputMode="numeric" className="mono" />
          </div>
          {parts.length > 1 && !disabled ? (
            <div className="actions">
              <Button size="small" variant="danger" onClick={() => onChange(parts.filter((_, j) => j !== i))}>
                Remove part
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : (
        <p className="muted">Shares add up to 100%.</p>
      )}
      {!disabled ? (
        <Button size="small" onClick={() => onChange([...parts, newPart("0")])}>
          Add part
        </Button>
      ) : null}
    </div>
  );
}
