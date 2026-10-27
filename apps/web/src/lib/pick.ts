// Copyright (c) 2026, Rademics. All rights reserved.
// Switched-off records in pick-lists (launch check, 27 October 2026): a switched-off
// brand was listed next to the active one of the same name, with nothing to tell them
// apart. Filters keep it, marked; forms for new work leave it out unless already chosen.

interface Switchable {
  id: string;
  active?: boolean;
}

/** The name, with "(switched off)" after a switched-off record. */
export function pickLabel(name: string, r: Switchable): string {
  return r.active === false ? `${name} (switched off)` : name;
}

/** For a form: active records, plus any switched-off ones already chosen. Active first. */
export function forPicking<T extends Switchable>(rows: T[], keep: (string | null | undefined)[] = []): T[] {
  return rows.filter((r) => r.active !== false || keep.includes(r.id));
}

/** For a filter: every record, active first, switched-off ones after. */
export function forFilter<T extends Switchable>(rows: T[]): T[] {
  return [...rows.filter((r) => r.active !== false), ...rows.filter((r) => r.active === false)];
}
