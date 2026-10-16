// Copyright (c) 2026, Rademics. All rights reserved.
// A touch number pad (big 56 px keys) for quantities, prices, discounts,
// cash and PINs. The typed value is kept as text; nothing is turned into a
// floating-point number (rule 1).
"use client";

interface NumPadProps {
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  /** No decimal point (PINs, counts). */
  integer?: boolean;
  enterLabel?: string;
  /** Accessible name of the pad, e.g. "Quantity pad". */
  label?: string;
  maxLength?: number;
}

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "⌫"] as const;

export function pressKey(value: string, key: string, integer = false, maxLength = 12): string {
  if (key === "⌫") return value.slice(0, -1);
  if (key === "C") return "";
  if (key === ".") {
    if (integer || value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  if (!/^\d$/.test(key) || value.length >= maxLength) return value;
  // At most 3 places after the point (quantities); amounts are rounded by the server rules.
  const dot = value.indexOf(".");
  if (dot >= 0 && value.length - dot > 3) return value;
  return value === "0" ? key : value + key;
}

export function NumPad({ value, onChange, onEnter, integer = false, enterLabel = "Enter", label = "Number pad", maxLength = 12 }: NumPadProps) {
  return (
    <div className="till-numpad" role="group" aria-label={label}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className="till-key"
          disabled={integer && k === "."}
          aria-label={k === "⌫" ? "Delete last digit" : k}
          onClick={() => onChange(pressKey(value, k, integer, maxLength))}
        >
          {k}
        </button>
      ))}
      <button type="button" className="till-key till-key-wide" onClick={() => onChange("")}>
        Clear
      </button>
      {onEnter ? (
        <button type="button" className="till-key till-key-enter" onClick={onEnter}>
          {enterLabel}
        </button>
      ) : null}
    </div>
  );
}
