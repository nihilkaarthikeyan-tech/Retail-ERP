// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { combinationCount, numericValueProblem, variantCombinations, variantGrid, variantValuesKey } from './variants.js';

const colour = {
  attributeId: 'colour',
  values: [
    { value: 'Red', shortCode: 'RED' },
    { value: 'Blue', shortCode: 'BLU' },
  ],
};
const size = {
  attributeId: 'size',
  values: [
    { value: 'S', shortCode: 'S' },
    { value: 'M', shortCode: 'M' },
    { value: 'L', shortCode: 'L' },
  ],
};

describe('variants', () => {
  it('makes every combination with readable codes (decision 10)', () => {
    const combos = variantCombinations('SHIRT', 'Shirt', [colour, size]);
    expect(combos).toHaveLength(6);
    expect(combos.map((c) => c.code)).toEqual([
      'SHIRT-RED-S',
      'SHIRT-RED-M',
      'SHIRT-RED-L',
      'SHIRT-BLU-S',
      'SHIRT-BLU-M',
      'SHIRT-BLU-L',
    ]);
    expect(combos[1].name).toBe('Shirt Red M');
  });

  it('counts combinations and refuses more than 500', () => {
    expect(combinationCount([colour, size])).toBe(6);
    const big = { attributeId: 'n', values: Array.from({ length: 251 }, (_, i) => ({ value: String(i), shortCode: String(i) })) };
    expect(() => variantCombinations('X', 'X', [big, colour])).toThrow(/502 combinations/);
    expect(() => variantCombinations('X', 'X', [{ attributeId: 'empty', values: [] }])).toThrow(/at least one value/);
  });

  it('identifies the same value set regardless of order or case', () => {
    const a = variantValuesKey([
      { attributeId: 'size', value: 'M' },
      { attributeId: 'colour', value: 'Red' },
    ]);
    const b = variantValuesKey([
      { attributeId: 'colour', value: 'red' },
      { attributeId: 'size', value: 'M' },
    ]);
    expect(a).toBe(b);
  });

  it('checks numeric values against range and step (shoe sizes 6–11 by 0.5)', () => {
    const range = { start: 6, end: 11, step: 0.5 };
    expect(numericValueProblem(8.5, range)).toBeNull();
    expect(numericValueProblem(8.25, range)).toMatch(/multiple of 0.5/);
    expect(numericValueProblem(12, range)).toMatch(/between 6 and 11/);
    expect(numericValueProblem(7, { start: 11, end: 6, step: 1 })).toMatch(/below its end/);
  });
});

describe('variantGrid', () => {
  const v = (id: string, colour: string, size: string) => ({ id, values: [{ attributeId: 'colour', value: colour }, { attributeId: 'size', value: size }] });
  const variants = [v('1', 'Red', 'XL'), v('2', 'Blue', 'M'), v('3', 'Red', 'S'), v('4', 'Red', 'M'), v('5', 'Blue', 'S')];

  it('puts the last attribute across and the first down, in each list order', () => {
    const g = variantGrid(['colour', 'size'], variants, { size: ['S', 'M', 'L', 'XL'], colour: ['Red', 'Blue'] });
    expect(g.across).toEqual(['S', 'M', 'XL']);
    expect(g.down).toEqual(['Red', 'Blue']);
    expect(g.cell('Red', 'M')?.id).toBe('4');
    expect(g.cell('Blue', 'XL')).toBeNull();
  });

  it('makes one row for a style with one attribute, numbers in ascending order', () => {
    const shoes = ['9', '7', '8.5'].map((s, i) => ({ id: String(i), values: [{ attributeId: 'shoe', value: s }] }));
    const g = variantGrid(['shoe'], shoes);
    expect(g.down).toEqual([null]);
    expect(g.across).toEqual(['7', '8.5', '9']);
    expect(g.cell(null, '8.5')?.id).toBe('2');
  });
});
