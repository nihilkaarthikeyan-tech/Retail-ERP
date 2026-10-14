// Copyright (c) 2026, Rademics. All rights reserved.
// Barcode formats and their check digits (blueprint 03, business rules).

export const BARCODE_TYPES = ['EAN13', 'EAN8', 'UPCA', 'CODE39', 'other'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

const GTIN_LENGTHS: Partial<Record<BarcodeType, number>> = { EAN13: 13, EAN8: 8, UPCA: 12 };

/**
 * GS1 modulo-10 check: weights 3 and 1 alternate from the right-most data
 * digit; the check digit makes the weighted sum a multiple of ten.
 */
export function gtinCheckDigit(dataDigits: string): number {
  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Returns null when the code is valid for the type, otherwise the reason. */
export function barcodeProblem(code: string, type: BarcodeType): string | null {
  if (code.length === 0) return 'Barcode is empty';
  if (/\s/.test(code)) return 'Barcode must not contain spaces';
  const length = GTIN_LENGTHS[type];
  if (length !== undefined) {
    if (!/^[0-9]+$/.test(code)) return `${type} barcodes contain digits only`;
    if (code.length !== length) return `${type} barcodes have ${length} digits`;
    const expected = gtinCheckDigit(code.slice(0, -1));
    if (expected !== Number(code[code.length - 1])) return `Wrong check digit (expected ${expected})`;
    return null;
  }
  if (type === 'CODE39' && !/^[0-9A-Z\-. $/+%]+$/.test(code)) {
    return 'Code 39 allows capital letters, digits and - . $ / + %';
  }
  return null;
}

/** Best guess of the type from the code alone, for scanners that do not say. */
export function guessBarcodeType(code: string): BarcodeType {
  for (const type of ['EAN13', 'EAN8', 'UPCA'] as const) {
    if (barcodeProblem(code, type) === null) return type;
  }
  return 'other';
}
