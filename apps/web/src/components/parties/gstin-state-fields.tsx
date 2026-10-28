// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { StateOptions } from "@/components/address-fields";
import { type GstinFactsDto, GstinCheckBox, type SavedGstinCheck } from "@/components/parties/gstin-check-box";
import { SelectInput, TextInput } from "@/components/ui";
import { stateFromGstin } from "@/lib/parties";
import type { FieldErrors } from "@/lib/validation";

export interface GstinStateValues {
  gstin: string;
  stateCode: string;
}

interface GstinStateFieldsProps {
  idPrefix: string;
  values: GstinStateValues;
  onChange: (next: GstinStateValues) => void;
  errors?: FieldErrors;
  disabled?: boolean;
  /** Hide the GSTIN input (the walk-in customer has none). */
  withoutGstin?: boolean;
  stateRequired?: boolean;
  gstinHint?: string;
  /** Plan 15: what the saved record said about its GSTIN, shown while the GSTIN is unchanged. */
  saved?: { gstin: string | null; check: SavedGstinCheck | null | undefined } | null;
  /** Plan 15: fill the form from the GST network's answer. */
  onUseDetails?: (facts: GstinFactsDto) => void;
}

/**
 * GSTIN and state together: the state is read from the GSTIN's first two
 * digits and cannot be changed while a GSTIN is typed (the API checks the same).
 */
export function GstinStateFields({ idPrefix, values, onChange, errors = {}, disabled, withoutGstin, stateRequired, gstinHint, saved, onUseDetails }: GstinStateFieldsProps) {
  const hasGstin = values.gstin.trim() !== "";
  return (
    <>
      {!withoutGstin ? (
        <TextInput
          id={`${idPrefix}-gstin`}
          label="GSTIN"
          value={values.gstin}
          onChange={(e) => {
            const gstin = e.target.value.toUpperCase();
            const fromGstin = stateFromGstin(gstin);
            onChange({ gstin, stateCode: fromGstin ?? values.stateCode });
          }}
          error={errors.gstin}
          className="mono"
          autoComplete="off"
          maxLength={15}
          disabled={disabled}
          hint={gstinHint ?? "15 characters; the state is read from its first two digits."}
        />
      ) : null}
      {!withoutGstin ? (
        <GstinCheckBox gstin={values.gstin} saved={saved && saved.gstin === values.gstin.trim().toUpperCase() ? saved.check : null} onUseDetails={onUseDetails} disabled={disabled} />
      ) : null}
      <SelectInput
        id={`${idPrefix}-stateCode`}
        label="State"
        value={values.stateCode}
        onChange={(e) => onChange({ ...values, stateCode: e.target.value })}
        error={errors.stateCode}
        required={stateRequired}
        disabled={disabled || hasGstin}
        hint={hasGstin ? "Set by the GSTIN." : undefined}
      >
        <StateOptions />
      </SelectInput>
    </>
  );
}
