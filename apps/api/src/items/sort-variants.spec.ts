// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { sortVariants } from './items.service.js';

const v = (code: string, colour: string, size: string) => ({ code, variantValues: [{ attributeId: 'C', value: colour }, { attributeId: 'S', value: size }] });

describe('sortVariants', () => {
  // Found in the launch check of 27 October 2026: variants were listed L, M, S (by code).
  it('lists by colour, then size, each in its list order, not by code', () => {
    const order = new Map([
      ['C|Red', 2],
      ['C|Blue', 3],
      ['S|S', 0],
      ['S|M', 1],
      ['S|L', 2],
    ]);
    const rows = [v('K-BLU-L', 'Blue', 'L'), v('K-BLU-M', 'Blue', 'M'), v('K-RED-L', 'Red', 'L'), v('K-RED-S', 'Red', 'S'), v('K-BLU-S', 'Blue', 'S'), v('K-RED-M', 'Red', 'M')];
    expect(sortVariants(rows, ['C', 'S'], order).map((r) => r.code)).toEqual(['K-RED-S', 'K-RED-M', 'K-RED-L', 'K-BLU-S', 'K-BLU-M', 'K-BLU-L']);
  });

  it('puts a value no longer in the list last, then sorts by code', () => {
    const order = new Map([['S|M', 0]]);
    const rows = [{ code: 'B', variantValues: [{ attributeId: 'S', value: 'Old' }] }, { code: 'A', variantValues: [{ attributeId: 'S', value: 'M' }] }, { code: 'C', variantValues: [{ attributeId: 'S', value: 'Gone' }] }];
    expect(sortVariants(rows, ['S'], order).map((r) => r.code)).toEqual(['A', 'B', 'C']);
  });
});
