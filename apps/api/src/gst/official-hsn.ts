// Copyright (c) 2026, Rademics. All rights reserved.
// The official HSN (goods) and SAC (services) codes, read from the GST portal's HSN_SAC.xlsx
// (owner, 28 October 2026; source and date in apps/api/data/gst/README.md).
import { readXlsx } from '../imports/spreadsheet.js';

/** The file in apps/api/data/gst that the list is loaded from; a new name loads a new list. */
export const HSN_FILE = 'HSN_SAC-2026-10-26.xlsx';

export interface OfficialHsnRow {
  code: string;
  description: string;
  isService: boolean;
}

/**
 * A code as the portal means it. Excel dropped the leading zero of a few codes (30559 is
 * 030559) and two have a space inside ("2307 00"); valid codes have 2, 4, 6 or 8 digits.
 */
export function cleanHsnCode(raw: unknown): string | null {
  const digits = (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '').replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const code = digits.length % 2 === 1 ? `0${digits}` : digits;
  return [2, 4, 6, 8].includes(code.length) ? code : null;
}

/** The description without Excel's leftover line-break marks; "~" (heading~detail) shown as " — ". */
export function cleanHsnDescription(raw: unknown): string {
  // Only text or a number is read; anything else (an empty or odd cell) counts as no description.
  return (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '')
    .replace(/_x000D_/g, ' ')
    .replace(/\s*~\s*/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every row of both sheets, cleaned, first one kept when a code repeats. */
export function readOfficialHsnFile(buf: Buffer): OfficialHsnRow[] {
  const out = new Map<string, OfficialHsnRow>();
  for (const [sheet, isService] of [
    ['HSN_MSTR', false],
    ['SAC_MSTR', true],
  ] as const) {
    for (const row of readXlsx(buf, sheet).slice(1)) {
      const code = cleanHsnCode(row[0]);
      if (code && !out.has(code)) out.set(code, { code, description: cleanHsnDescription(row[1]), isService });
    }
  }
  return [...out.values()];
}
