// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { codeFromName, GSTIN_RE, gstinStateCode, panFromGstin } from './company.js';

describe('company helpers', () => {
  it('makes a short code from the initials of the name', () => {
    expect(codeFromName('Rademics Retail Pvt Ltd')).toBe('RRPL');
    expect(codeFromName('  spaced   out ')).toBe('SO');
    expect(codeFromName('A&B Traders')).toBe('ABT');
  });

  it('checks GSTIN format and reads its parts', () => {
    const gstin = '33AAACR1234A1ZV';
    expect(GSTIN_RE.test(gstin)).toBe(true);
    expect(GSTIN_RE.test('33AAACR1234A1YV')).toBe(false);
    expect(gstinStateCode(gstin)).toBe('33');
    expect(panFromGstin(gstin)).toBe('AAACR1234A');
  });
});
