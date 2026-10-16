// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { markdownPrice } from './markdowns.js';

describe('markdownPrice', () => {
  it('takes a percentage off the old price and rounds to the rupee', () => {
    expect(markdownPrice('percent', '30', '999', '1299')).toEqual({ price: '699.00', cappedAtMrp: false });
    // 70% of 1,299 is 909.30 → 909; 70% of 1,085 is 759.50 → 760 (an exact half goes up).
    expect(markdownPrice('percent', '30', '1299', null)?.price).toBe('909.00');
    expect(markdownPrice('percent', '30', '1085', null)?.price).toBe('760.00');
  });

  it('uses a fixed price as given, rounded to the rupee', () => {
    expect(markdownPrice('price', '499.40', '999', '1299')).toEqual({ price: '499.00', cappedAtMrp: false });
    expect(markdownPrice('price', '499', null, null)?.price).toBe('499.00');
  });

  it('never goes above the MRP', () => {
    expect(markdownPrice('price', '1500', '999', '1299')).toEqual({ price: '1299.00', cappedAtMrp: true });
    // An MRP with paise: the rupee below it.
    expect(markdownPrice('price', '200', null, '199.50')).toEqual({ price: '199.00', cappedAtMrp: true });
    // An old price already above the MRP comes down to it even after the percentage.
    expect(markdownPrice('percent', '10', '1500', '1299')).toEqual({ price: '1299.00', cappedAtMrp: true });
  });

  it('cannot take a percentage off an item with no price', () => {
    expect(markdownPrice('percent', '30', null, '999')).toBeNull();
  });
});
