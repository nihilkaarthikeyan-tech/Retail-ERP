// Copyright (c) 2026, Rademics. All rights reserved.

/** Default short code = first letter of each word of the name, in capitals. */
export function codeFromName(name: string): string {
  return name
    .split(/[\s\-_/&.,]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * A code suggested from a name as it is typed (launch check, 27 October 2026: owners
 * typed a code for every group, brand and store). "Ethnic wear" → ETHNIC-WEAR with a
 * joiner of "-", ANNANAGAR without. The person may still change it.
 */
export function suggestCode(name: string, max: number, joiner = ''): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0);
  return words.join(joiner).slice(0, max).replace(/-+$/, '');
}

/**
 * GSTIN format: 2-digit state code, 10-character PAN, entity number,
 * the letter Z, and a check character. Format only; the registration
 * itself is verified by the accountant on the GST portal.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}

export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}
