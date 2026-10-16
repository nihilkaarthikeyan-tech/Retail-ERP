// Copyright (c) 2026, Rademics. All rights reserved.
// Reading cells from imported files (plan 10 §1.C and §4; blueprint 17 edge
// cases). Numbers may use Indian grouping (1,05,000.50); dates are read
// day-first, as written in India; anything unclear is reported, never guessed.
import { isIsoDate } from './financial-year.js';

export type CellResult<T> = { ok: true; value: T } | { ok: false; problem: string };

/** A number as typed in India or abroad: 1,05,000.50 · 105000.5 · ₹ 1,200 · -45. */
export function readNumber(raw: unknown): CellResult<string> {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, problem: 'is not a number' };
    // Spreadsheet numbers come as binary floats; 15 significant digits is what the spreadsheet itself shows.
    return { ok: true, value: String(Number(raw.toPrecision(15))) };
  }
  const text = String(raw ?? '').trim().replace(/^₹\s*/, '').replace(/^Rs\.?\s*/i, '');
  if (text === '') return { ok: false, problem: 'is empty' };
  if (!/^-?[\d,]*\.?\d+$/.test(text)) return { ok: false, problem: `"${text}" is not a number` };
  const [whole] = text.replace(/^-/, '').split('.');
  if (whole.includes(',')) {
    // Indian (1,05,000) or international (105,000) grouping: groups must be 2 or 3 digits, ending in a group of 3.
    const groups = whole.split(',');
    const last = groups[groups.length - 1];
    const middle = groups.slice(1, -1);
    const indian = last.length === 3 && middle.every((g) => g.length === 2) && groups[0].length >= 1 && groups[0].length <= 2;
    const international = last.length === 3 && middle.every((g) => g.length === 3) && groups[0].length >= 1 && groups[0].length <= 3;
    if (!indian && !international) return { ok: false, problem: `"${text}" has commas in the wrong places` };
  }
  return { ok: true, value: text.replace(/,/g, '') };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Days since 30 December 1899, as spreadsheets count dates. */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
  return new Date(ms).toISOString().slice(0, 10);
}

/** A date written 2026-10-16, 16/10/2026, 16-10-2026, 16.10.2026, 16-Oct-2026 or 16 Oct 2026, or a spreadsheet date. */
export function readDate(raw: unknown): CellResult<string> {
  if (typeof raw === 'number') return raw > 0 && raw < 2958466 ? { ok: true, value: excelSerialToIso(raw) } : { ok: false, problem: 'is not a date' };
  if (raw instanceof Date) return { ok: true, value: raw.toISOString().slice(0, 10) };
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: false, problem: 'is empty' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isIsoDate(text) ? { ok: true, value: text } : { ok: false, problem: `"${text}" is not a real date` };
  let m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  let day: number;
  let month: number;
  let year: number;
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  } else {
    m = text.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]*(\d{2}|\d{4})$/);
    if (!m) return { ok: false, problem: `"${text}" is not a date; write it as 16/10/2026` };
    day = Number(m[1]);
    month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    year = Number(m[3]);
    if (month === 0) return { ok: false, problem: `"${m[2]}" is not a month` };
  }
  if (year < 100) year += 2000;
  if (month > 12) return { ok: false, problem: `"${text}" is unclear: dates are read day first (16/10/2026)` };
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(iso) ? { ok: true, value: iso } : { ok: false, problem: `"${text}" is not a real date` };
}

/** Text kept exactly as typed (codes, barcodes, HSN, mobile): a number cell that lost its leading zeros is reported. */
export function readText(raw: unknown, opts: { digitsLength?: number[] } = {}): CellResult<string> {
  if (raw === null || raw === undefined) return { ok: false, problem: 'is empty' };
  if (typeof raw === 'number') {
    const s = String(raw);
    if (opts.digitsLength && !opts.digitsLength.includes(s.length)) return { ok: false, problem: `${s} looks like a number that lost its leading zeros; format the column as text` };
    return { ok: true, value: s };
  }
  const text = String(raw).trim();
  return text ? { ok: true, value: text } : { ok: false, problem: 'is empty' };
}

/** Yes / no columns. */
export function readYesNo(raw: unknown): CellResult<boolean> {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  const t = String(raw ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(t)) return { ok: true, value: true };
  if (['no', 'n', 'false', '0', ''].includes(t)) return { ok: true, value: false };
  return { ok: false, problem: `"${raw}" should be Yes or No` };
}
