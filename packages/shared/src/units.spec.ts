// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { conversionFactor, fractionsAllowedForKind, pricePerBasicUnit, quantityProblem, toBasicUnits } from './units.js';

const PCS = { code: 'PCS', allowsFractions: false };
const KG = { code: 'KG', allowsFractions: true };

describe('units', () => {
  it('allows fractions only for weight, length and volume (decision 11)', () => {
    expect(fractionsAllowedForKind('count')).toBe(false);
    expect(fractionsAllowedForKind('other')).toBe(false);
    expect(fractionsAllowedForKind('weight')).toBe(true);
    expect(fractionsAllowedForKind('length')).toBe(true);
    expect(fractionsAllowedForKind('volume')).toBe(true);
  });

  it('refuses 1.5 pieces but accepts 1.5 kg', () => {
    expect(quantityProblem('1.5', PCS)).toMatch(/whole numbers/);
    expect(quantityProblem('2', PCS)).toBeNull();
    expect(quantityProblem('2.000', PCS)).toBeNull();
    expect(quantityProblem('1.5', KG)).toBeNull();
    expect(quantityProblem('abc', KG)).toMatch(/must be a number/);
  });

  it('converts directly, in reverse and through a middle unit', () => {
    const rows = [
      { fromUnitId: 'KG', toUnitId: 'G', factor: '1000' },
      { fromUnitId: 'G', toUnitId: 'MG', factor: '1000' },
    ];
    expect(conversionFactor('KG', 'G', rows)?.toString()).toBe('1000');
    expect(conversionFactor('G', 'KG', rows)?.toString()).toBe('0.001');
    expect(conversionFactor('KG', 'MG', rows)?.toString()).toBe('1000000');
    expect(conversionFactor('MG', 'KG', rows)?.toString()).toBe('0.000001');
    expect(conversionFactor('KG', 'KG', rows)?.toString()).toBe('1');
    expect(conversionFactor('KG', 'L', rows)).toBeNull();
  });

  it('works out basic units and price per basic unit exactly', () => {
    expect(toBasicUnits('2', '12').toString()).toBe('24');
    expect(toBasicUnits('0.5', '1000').toString()).toBe('500');
    expect(pricePerBasicUnit('1320', '12').toString()).toBe('110');
    expect(pricePerBasicUnit('100', '3').toFixed(4)).toBe('33.3333');
  });
});
