// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { SelectInput, TextInput } from "@/components/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Days a month can have, counting 29 February (a real day in leap years). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface DayMonthYear {
  day: string;
  month: string;
  year: string;
}

export const blankDate: DayMonthYear = { day: "", month: "", year: "" };

/** "08-15" + 1990 → the form's three fields. */
export function splitDayMonth(dayMonth: string | null, year: number | null): DayMonthYear {
  if (!dayMonth) return blankDate;
  return { month: String(Number(dayMonth.slice(0, 2))), day: String(Number(dayMonth.slice(3))), year: year ? String(year) : "" };
}

/**
 * The form's three fields as the API wants them: "MM-DD" (or null when no day
 * and month) and the year (null when blank). A year that is not a number is
 * passed on as NaN so the shared check reports it.
 */
export function joinDayMonth(v: DayMonthYear): { dayMonth: string | null; year: number | null } {
  const dayMonth = v.day && v.month ? `${v.month.padStart(2, "0")}-${v.day.padStart(2, "0")}` : null;
  const y = v.year.trim();
  return { dayMonth, year: y ? (/^\d{4}$/.test(y) ? Number(y) : Number.NaN) : null };
}

/** Day, month and an optional year, for a birthday or an anniversary (plan 11 C10). */
export function DayMonthYearFields({ idPrefix, label, value, onChange, error, yearError, disabled }: { idPrefix: string; label: string; value: DayMonthYear; onChange: (v: DayMonthYear) => void; error?: string | null; yearError?: string | null; disabled?: boolean }) {
  const days = value.month ? MONTH_DAYS[Number(value.month) - 1] : 31;
  return (
    <>
      <SelectInput id={`${idPrefix}-month`} label={`${label}: month`} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value, day: Number(value.day) > (e.target.value ? MONTH_DAYS[Number(e.target.value) - 1] : 31) ? "" : value.day })} error={error} disabled={disabled}>
        <option value="">—</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </SelectInput>
      <SelectInput id={`${idPrefix}-day`} label={`${label}: day`} value={value.day} onChange={(e) => onChange({ ...value, day: e.target.value })} disabled={disabled}>
        <option value="">—</option>
        {Array.from({ length: days }, (_, i) => String(i + 1)).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </SelectInput>
      <TextInput id={`${idPrefix}-year`} label={`${label}: year`} hint="Optional." value={value.year} onChange={(e) => onChange({ ...value, year: e.target.value })} error={yearError} inputMode="numeric" maxLength={4} className="mono" autoComplete="off" disabled={disabled} />
    </>
  );
}
