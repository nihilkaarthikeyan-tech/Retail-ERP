// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { moneyString, quantityString, roundMoney, roundQuantity, roundTo } from './rounding.js';

describe('rounding (decision 5: half goes away from zero)', () => {
  it('rounds an exact half up for positive values', () => {
    expect(roundTo('2.5', 0).toString()).toBe('3');
    expect(roundTo('3.5', 0).toString()).toBe('4');
    expect(roundMoney('1.005').toString()).toBe('1.01');
    expect(roundMoney('0.125').toString()).toBe('0.13');
  });

  it('rounds an exact half away from zero for negative values', () => {
    expect(roundTo('-2.5', 0).toString()).toBe('-3');
    expect(roundMoney('-1.005').toString()).toBe('-1.01');
  });

  it('rounds below a half down', () => {
    expect(roundTo('2.4', 0).toString()).toBe('2');
    expect(roundMoney('1.004').toString()).toBe('1');
    expect(roundMoney('99.994').toString()).toBe('99.99');
  });

  it('is not fooled by binary floating point', () => {
    // 1.005 as a JS number is 1.00499999…; as a string it is exact.
    expect(roundMoney('1.005').toString()).toBe('1.01');
    expect(roundMoney('2.675').toString()).toBe('2.68');
  });

  it('rounds quantities to three places', () => {
    expect(roundQuantity('1.2345').toString()).toBe('1.235');
    expect(roundQuantity('1.2344').toString()).toBe('1.234');
  });

  it('formats fixed-point strings', () => {
    expect(moneyString('5')).toBe('5.00');
    expect(moneyString('5.1')).toBe('5.10');
    expect(quantityString('2')).toBe('2.000');
  });
});
