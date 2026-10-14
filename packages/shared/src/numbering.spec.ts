// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { fillPattern, formatNumber, patternTokens, patternUsesStore } from './numbering.js';

const ctx = { date: '2026-10-14', financialYearName: '2026-27', storeCode: 'MAIN', companyCode: 'RRPL' };

describe('number patterns', () => {
  it('fills every token', () => {
    expect(fillPattern('{COMPANY}/{STORE}/{YYYY}{MM}{DD}/{YY}/{FY}/', ctx)).toBe(
      'RRPL/MAIN/20261014/26/2026-27/',
    );
  });

  it('pads the counter and never truncates it', () => {
    expect(formatNumber('INV-MAIN-2026-27-', 1, 5)).toBe('INV-MAIN-2026-27-00001');
    expect(formatNumber('INV-', 123456, 5)).toBe('INV-123456');
  });

  it('refuses unknown tokens and bad counters', () => {
    expect(() => patternTokens('INV-{SHOP}-')).toThrow('Unknown token {SHOP}');
    expect(() => fillPattern('INV-{STORE}-', { ...ctx, storeCode: undefined })).toThrow('no store');
    expect(() => formatNumber('X', 0, 5)).toThrow();
  });

  it('reports whether a pattern depends on the store', () => {
    expect(patternUsesStore('PO-{FY}-')).toBe(false);
    expect(patternUsesStore('PO-{STORE}-')).toBe(true);
  });

  it('a pattern without tokens is a plain prefix', () => {
    expect(fillPattern('JV-', ctx)).toBe('JV-');
  });
});
