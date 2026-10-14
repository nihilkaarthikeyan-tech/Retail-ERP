// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { INDIAN_STATE_OPTIONS } from "shared";
import { SelectInput, TextInput } from "@/components/ui";
import type { FieldErrors } from "@/lib/validation";

export interface AddressValues {
  addressLine1: string;
  addressLine2: string;
  city: string;
  pincode: string;
  stateCode: string;
}

export const emptyAddress: AddressValues = { addressLine1: "", addressLine2: "", city: "", pincode: "", stateCode: "" };

interface AddressFieldsProps {
  values: AddressValues;
  onChange: (next: AddressValues) => void;
  errors?: FieldErrors;
  /** Unique prefix for input ids when several address blocks share a page. */
  idPrefix: string;
  /** Hide the state select (GST registrations take their state from the GSTIN). */
  withState?: boolean;
  stateRequired?: boolean;
  stateDisabled?: boolean;
}

export function StateOptions() {
  return (
    <>
      <option value="">Select a state…</option>
      {INDIAN_STATE_OPTIONS.map(([code, name]) => (
        <option key={code} value={code}>
          {code} — {name}
        </option>
      ))}
    </>
  );
}

export function AddressFields({
  values,
  onChange,
  errors = {},
  idPrefix,
  withState = true,
  stateRequired,
  stateDisabled,
}: AddressFieldsProps) {
  const set = (key: keyof AddressValues) => (e: { target: { value: string } }) =>
    onChange({ ...values, [key]: e.target.value });
  return (
    <>
      <TextInput id={`${idPrefix}-addressLine1`} label="Address line 1" value={values.addressLine1} onChange={set("addressLine1")} error={errors.addressLine1} />
      <TextInput id={`${idPrefix}-addressLine2`} label="Address line 2" value={values.addressLine2} onChange={set("addressLine2")} error={errors.addressLine2} />
      <TextInput id={`${idPrefix}-city`} label="City" value={values.city} onChange={set("city")} error={errors.city} />
      <TextInput id={`${idPrefix}-pincode`} label="PIN code" value={values.pincode} onChange={set("pincode")} error={errors.pincode} inputMode="numeric" />
      {withState ? (
        <SelectInput
          id={`${idPrefix}-stateCode`}
          label="State"
          value={values.stateCode}
          onChange={set("stateCode")}
          error={errors.stateCode}
          required={stateRequired}
          disabled={stateDisabled}
        >
          <StateOptions />
        </SelectInput>
      ) : null}
    </>
  );
}

/** Address values ready for the API: blanks become null. */
export function addressPayload(values: AddressValues, withState = true) {
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    addressLine1: n(values.addressLine1),
    addressLine2: n(values.addressLine2),
    city: n(values.city),
    pincode: n(values.pincode),
    ...(withState ? { stateCode: n(values.stateCode) } : {}),
  };
}

export function addressFrom(source: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode?: string | null;
}): AddressValues {
  return {
    addressLine1: source.addressLine1 ?? "",
    addressLine2: source.addressLine2 ?? "",
    city: source.city ?? "",
    pincode: source.pincode ?? "",
    stateCode: source.stateCode ?? "",
  };
}
