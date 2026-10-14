// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { barcodeProblem, gtinCheckDigit, guessBarcodeType } from './barcodes.js';

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1); // EAN-13 4006381333931
    expect(gtinCheckDigit('890123456789')).toBe(0); // EAN-13 8901234567890
    expect(gtinCheckDigit('0123456')).toBe(5); // EAN-8 01234565
    expect(gtinCheckDigit('03600029145')).toBe(2); // UPC-A 036000291452
  });

  it('accepts valid codes and refuses wrong check digits or lengths', () => {
    expect(barcodeProblem('8901234567890', 'EAN13')).toBeNull();
    expect(barcodeProblem('8901234567894', 'EAN13')).toMatch(/check digit/);
    expect(barcodeProblem('890123456789', 'EAN13')).toMatch(/13 digits/);
    expect(barcodeProblem('01234565', 'EAN8')).toBeNull();
    expect(barcodeProblem('036000291452', 'UPCA')).toBeNull();
    expect(barcodeProblem('ABC-123', 'CODE39')).toBeNull();
    expect(barcodeProblem('abc', 'CODE39')).toMatch(/capital/);
    expect(barcodeProblem('anything-goes', 'other')).toBeNull();
    expect(barcodeProblem('has space', 'other')).toMatch(/spaces/);
  });

  it('guesses the type from the code', () => {
    expect(guessBarcodeType('8901234567890')).toBe('EAN13');
    expect(guessBarcodeType('01234565')).toBe('EAN8');
    expect(guessBarcodeType('036000291452')).toBe('UPCA');
    expect(guessBarcodeType('SHIRT-RED-M')).toBe('other');
  });
});
