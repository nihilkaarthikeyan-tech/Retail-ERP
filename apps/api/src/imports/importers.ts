// Copyright (c) 2026, Rademics. All rights reserved.
// What can be imported, and how each row is saved (plan 10 §1.C). Every row
// goes through the same service a person typing it in would use, so every
// business rule of that record applies (blueprint 17). A row is saved or
// refused on its own; nothing is half-made.
import { type CurrentUser, type ImportKind, type ImportMode, type PermissionKey, readDate, readNumber, readText, readYesNo } from 'shared';
import type { Actor } from '../common/request-context.js';
import type { Cell } from './spreadsheet.js';

export type FieldType = 'text' | 'code' | 'number' | 'date' | 'yesno';

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Other headings that mean the same column. */
  aliases?: string[];
  /** Barcodes and the like: a number cell with a different length lost its leading zeros. */
  digitsLength?: number[];
  hint?: string;
}

/** A row read against the fields: the values, and the problems found. */
export interface ParsedRow {
  values: Record<string, string | boolean | null>;
  problems: string[];
}

export type RowOutcome = { outcome: 'added' | 'changed' | 'unchanged'; recordId?: string | null; message?: string };

export interface ImportContext {
  user: CurrentUser;
  actor: Actor;
  companyId: string;
  /** Rows already handled in this run that later rows may refer to (tree folders). */
  seen: Map<string, string>;
}

export interface Importer {
  kind: ImportKind;
  fields: Field[];
  /** Rights needed besides the import right (blueprint 17: the rights to create or change what the rows do). */
  rights: PermissionKey[];
  importRight: PermissionKey;
  example: (string | number | null)[];
  /** A key that names the record, so a rerun finds rows already done. */
  keyOf(v: ParsedRow['values']): string | null;
  apply(v: ParsedRow['values'], mode: ImportMode, ctx: ImportContext): Promise<RowOutcome>;
  /** Rows for "Export for Excel", in the same columns (kinds that can be exported). */
  exportRows?(ctx: { user: CurrentUser; companyId: string }): Promise<(string | number | boolean | null)[][]>;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Matches file headings to fields: by label, key or alias; anything else is left unmatched. */
export function matchColumns(headings: Cell[], fields: Field[], overrides: Record<string, string> = {}): { columns: (string | null)[]; unmatched: string[] } {
  const byName = new Map<string, string>();
  for (const f of fields) for (const n of [f.label, f.key, ...(f.aliases ?? [])]) byName.set(normalise(n), f.key);
  const columns: (string | null)[] = [];
  const unmatched: string[] = [];
  const used = new Set<string>();
  for (const h of headings) {
    const heading = String(h ?? '').trim();
    if (!heading) {
      columns.push(null);
      continue;
    }
    const chosen = heading in overrides ? overrides[heading] || null : (byName.get(normalise(heading)) ?? null);
    if (chosen && !used.has(chosen) && fields.some((f) => f.key === chosen)) {
      columns.push(chosen);
      used.add(chosen);
    } else {
      columns.push(null);
      unmatched.push(heading);
    }
  }
  return { columns, unmatched };
}

/** Reads one file row against the fields (types and required values only; links are checked when saving). */
export function parseRow(cells: Cell[], columns: (string | null)[], fields: Field[]): ParsedRow {
  const values: ParsedRow['values'] = {};
  const problems: string[] = [];
  for (const f of fields) values[f.key] = null;
  columns.forEach((key, i) => {
    if (!key) return;
    const f = fields.find((x) => x.key === key)!;
    const raw = cells[i];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return;
    const r = f.type === 'number' ? readNumber(raw) : f.type === 'date' ? readDate(raw) : f.type === 'yesno' ? readYesNo(raw) : readText(raw, { digitsLength: f.digitsLength });
    if (r.ok) values[f.key] = r.value;
    else problems.push(`${f.label} ${r.problem}`);
  });
  for (const f of fields) if (f.required && (values[f.key] === null || values[f.key] === '')) problems.push(`${f.label} is missing`);
  return { values, problems };
}

/** The text of a value, or undefined when the column was empty. */
export const str = (v: string | boolean | null | undefined) => (v === null || v === undefined || v === '' ? undefined : String(v));
export const bool = (v: string | boolean | null | undefined) => (v === null || v === undefined ? undefined : v === true || v === 'true');
