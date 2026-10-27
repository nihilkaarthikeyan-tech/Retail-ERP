// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { codeFromName, suggestCode, GSTIN_RE, gstinStateCode, panFromGstin } from './company.js';

describe('company helpers', () => {
  it('makes a short code from the initials of the name', () => {
    expect(codeFromName('Rademics Retail Pvt Ltd')).toBe('RRPL');
    expect(codeFromName('  spaced   out ')).toBe('SO');
    expect(codeFromName('A&B Traders')).toBe('ABT');
  });

  it('suggests a code from a name as it is typed', () => {
    expect(suggestCode('Ethnic wear', 20, '-')).toBe('ETHNIC-WEAR');
    expect(suggestCode("Women's tops & tees", 20, '-')).toBe('WOMEN-S-TOPS-TEES');
    expect(suggestCode('Anna Nagar', 10)).toBe('ANNANAGAR');
    expect(suggestCode('Sri Lakshmi Fashions', 10)).toBe('SRILAKSHMI');
    expect(suggestCode('Kids wear', 6, '-')).toBe('KIDS-W');
    expect(suggestCode('Kids  ', 5, '-')).toBe('KIDS');
    expect(suggestCode('', 10)).toBe('');
  });

  it('checks GSTIN format and reads its parts', () => {
    const gstin = '33AAACR1234A1ZA';
    expect(GSTIN_RE.test(gstin)).toBe(true);
    expect(GSTIN_RE.test('33AAACR1234A1YV')).toBe(false);
    expect(gstinStateCode(gstin)).toBe('33');
    expect(panFromGstin(gstin)).toBe('AAACR1234A');
  });
});
