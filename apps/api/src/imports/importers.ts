// Copyright (c) 2026, Rademics. All rights reserved.
// What can be imported, and how each row is saved (plan 10 §1.C). Every row
// goes through the same service a person typing it in would use, so every
// business rule of that record applies (blueprint 17). A row is saved or
// refused on its own; nothing is half-made.
import { BadRequestException } from '@nestjs/common';
import { businessDate, type CurrentUser, type ImportKind, type ImportMode, type PermissionKey, readDate, readDayMonth, readNumber, readText, readYesNo } from 'shared';
import type { Actor } from '../common/request-context.js';
import type { Cell } from './spreadsheet.js';

/** daymonth: a birthday or anniversary, a full date or only the day and month (plan 11 C10). */
export type FieldType = 'text' | 'code' | 'number' | 'date' | 'daymonth' | 'yesno';

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
  /** Kinds whose columns depend on the masters (styles and variants: one column per size, colour or other attribute). */
  columns?(): Promise<{ fields: Field[]; example: (string | number | null)[] }>;
  /** A key that names the record, so a rerun finds rows already done. */
  keyOf(v: ParsedRow['values']): string | null;
  apply(v: ParsedRow['values'], mode: ImportMode, ctx: ImportContext): Promise<RowOutcome>;
  /** Rows for "Export for Excel", in the same columns (kinds that can be exported). */
  exportRows?(ctx: { user: CurrentUser; companyId: string }): Promise<(string | number | boolean | null)[][]>;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Headings that lists exported from other billing and accounts software commonly use, so such a
 * file is matched without the person choosing every column by hand (launch check, 27 October
 * 2026). Plain business words only; any column can still be matched on the screen.
 */
const COMMON_HEADINGS: Record<string, string[]> = {
  name: ['Item Name', 'Product Name', 'Party Name', 'Customer Name', 'Supplier Name', 'Ledger Name', 'Particulars'],
  code: ['Item Code', 'Product Code', 'SKU', 'Party Code', 'Code'],
  mobile: ['Mobile No', 'Mobile Number', 'Phone', 'Phone No', 'Contact No', 'Contact Number', 'Cell'],
  email: ['Email ID', 'E-mail', 'Mail ID'],
  gstin: ['GSTIN/UIN', 'GST No', 'GST Number', 'GSTIN No'],
  pan: ['PAN No', 'PAN Number'],
  hsn: ['HSN/SAC', 'HSN', 'SAC', 'HSN No'],
  price: ['Rate', 'Sale Price', 'Sales Price', 'Selling Rate', 'Sale Rate'],
  cost: ['Rate', 'Purchase Price', 'Purchase Rate', 'Cost', 'Cost Price'],
  quantity: ['Qty', 'Stock', 'Closing Stock', 'Opening Stock', 'Balance Qty'],
  unit: ['UOM', 'Units', 'Unit of Measure'],
  barcode: ['EAN', 'Bar Code', 'UPC'],
  line1: ['Address', 'Address 1', 'Address Line1'],
  line2: ['Address 2', 'Address Line2'],
  pincode: ['Pin', 'Pincode', 'Zip', 'Postal Code'],
  group: ['Category', 'Item Group', 'Group', 'Customer Group', 'Supplier Group'],
  brand: ['Brand', 'Make', 'Manufacturer'],
  amount: ['Balance', 'Outstanding', 'Pending Amount', 'Amount Due'],
  number: ['Invoice No', 'Bill No', 'Invoice Number'],
  date: ['Invoice Date', 'Date'],
  due: ['Due On'],
};

/** Matches file headings to fields: by label, key or alias; anything else is left unmatched. */
export function matchColumns(headings: Cell[], fields: Field[], overrides: Record<string, string> = {}): { columns: (string | null)[]; unmatched: string[] } {
  const byName = new Map<string, string>();
  // Common headings first, so a field's own label, key and aliases win over them.
  for (const f of fields) for (const n of COMMON_HEADINGS[f.key] ?? []) byName.set(normalise(n), f.key);
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
  const today = businessDate();
  for (const f of fields) values[f.key] = null;
  columns.forEach((key, i) => {
    if (!key) return;
    const f = fields.find((x) => x.key === key)!;
    const raw = cells[i];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return;
    const r = f.type === 'number' ? readNumber(raw) : f.type === 'date' ? readDate(raw) : f.type === 'daymonth' ? readDayMonth(raw, today) : f.type === 'yesno' ? readYesNo(raw) : readText(raw, { digitsLength: f.digitsLength });
    if (r.ok) values[f.key] = r.value;
    else problems.push(`${f.label} ${r.problem}`);
  });
  for (const f of fields) if (f.required && (values[f.key] === null || values[f.key] === '')) problems.push(`${f.label} is missing`);
  return { values, problems };
}

/** The text of a value, or undefined when the column was empty. */
export const str = (v: string | boolean | null | undefined) => (v === null || v === undefined || v === '' ? undefined : String(v));
export const bool = (v: string | boolean | null | undefined) => (v === null || v === undefined ? undefined : v === true || v === 'true');

/**
 * A row's record, checked with the same rules as the screens (10-digit mobile, GSTIN check
 * character, HSN length and the rest) before it is saved; the row fails with the reason in plain
 * words. Found in the launch check of 27 October 2026: an 8-digit mobile and a mistyped GSTIN
 * were imported, because the checks ran only on what came from a screen.
 */
export function checked<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const problems = r.error.issues.map((i) => (i.path.length ? `${columnName(String(i.path.at(-1)))}: ${i.message}` : i.message));
  throw new BadRequestException([...new Set(problems)].join('; '));
}

/** "gstin" → "GSTIN", "itemGroupId" → "Item group", "pincode" → "PIN code". */
function columnName(key: string): string {
  const known: Record<string, string> = { gstin: 'GSTIN', pan: 'PAN', hsnCode: 'HSN code', pincode: 'PIN code', mrp: 'MRP', stateCode: 'State code' };
  if (known[key]) return known[key];
  const words = key.replace(/Id$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
