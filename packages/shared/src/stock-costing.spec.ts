// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { apply, EMPTY_STATE, expiryFromShelfLife, isExpiredOn, lowestQuantity, replay, type StockIntent } from './stock-costing.js';

const s = (lines: ReturnType<typeof replay>['lines'], i: number) => ({
  q: lines[i].after.quantity.toString(),
  cost: lines[i].after.unitCost.toFixed(4),
  value: lines[i].after.value.toFixed(2),
  qc: lines[i].quantityChange.toString(),
  vc: lines[i].valueChange.toFixed(2),
});

describe('moving average (scenarios 4.1–4.3)', () => {
  const run = replay(EMPTY_STATE, [
    { kind: 'set', targetQuantity: '100', targetCost: '90' },
    { kind: 'in', quantity: '50', incomingCost: '96' },
    { kind: 'out', quantity: '3' },
  ]);

  it('opening stock of 100 at 90', () => {
    expect(s(run.lines, 0)).toEqual({ q: '100', cost: '90.0000', value: '9000.00', qc: '100', vc: '9000.00' });
  });

  it('a receipt re-averages the cost', () => {
    expect(s(run.lines, 1)).toEqual({ q: '150', cost: '92.0000', value: '13800.00', qc: '50', vc: '4800.00' });
  });

  it('an issue leaves at the average and keeps the cost', () => {
    expect(s(run.lines, 2)).toEqual({ q: '147', cost: '92.0000', value: '13524.00', qc: '-3', vc: '-276.00' });
  });
});

describe('rounding', () => {
  it('rounds values to paise and costs to 4 places', () => {
    const r = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '3', incomingCost: '10' },
      { kind: 'in', quantity: '1', incomingCost: '11' },
    ]);
    expect(r.end.value.toFixed(2)).toBe('41.00');
    expect(r.end.unitCost.toFixed(4)).toBe('10.2500');
  });

  it('taking out the last units takes out the whole value, leaving no stray paise', () => {
    const r = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '3', incomingCost: '10' },
      { kind: 'in', quantity: '3', incomingCost: '10.01' },
      { kind: 'out', quantity: '4' },
      { kind: 'out', quantity: '2' },
    ]);
    expect(r.end.quantity.toString()).toBe('0');
    expect(r.end.value.toFixed(2)).toBe('0.00');
    const total = r.lines.reduce((sum, l) => sum.add(l.valueChange), r.lines[0].valueChange.mul(0));
    expect(total.toFixed(2)).toBe('0.00');
  });

  it('handles fractional quantities (kg)', () => {
    const r = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '12.5', incomingCost: '62' },
      { kind: 'out', quantity: '0.75' },
    ]);
    expect(r.end.quantity.toString()).toBe('11.75');
    expect(r.end.value.toFixed(2)).toBe('728.50');
  });
});

describe('transfers carry the cost', () => {
  it('a fixed cost out of transit equals the cost it went in at', () => {
    const transit = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '20', incomingCost: '92' },
      { kind: 'in', quantity: '10', incomingCost: '95' }, // a second send from another store
      { kind: 'out', quantity: '15', fixedCost: '92' },
    ]);
    expect(transit.lines[2].valueChange.toFixed(2)).toBe('-1380.00');
    expect(transit.end.value.toFixed(2)).toBe('1410.00'); // 5×92 + 10×95
  });
});

describe('counts', () => {
  it('a count down posts the difference at the current cost (4.7)', () => {
    const before = { quantity: d('127'), unitCost: d('92'), value: d('11684') };
    const r = apply(before, { kind: 'set', targetQuantity: '125' });
    expect(r.quantityChange.toString()).toBe('-2');
    expect(r.valueChange.toFixed(2)).toBe('-184.00');
  });

  it('a count with a new cost revalues the whole quantity', () => {
    const before = { quantity: d('10'), unitCost: d('50'), value: d('500') };
    const r = apply(before, { kind: 'set', targetQuantity: '10', targetCost: '55' });
    expect(r.quantityChange.toString()).toBe('0');
    expect(r.valueChange.toFixed(2)).toBe('50.00');
  });

  it('counting zero clears any leftover value', () => {
    const r = apply({ quantity: d('0'), unitCost: d('5'), value: d('0.03') }, { kind: 'set', targetQuantity: '0' });
    expect(r.after.value.toFixed(2)).toBe('0.00');
  });
});

describe('cancelling (4.11)', () => {
  it('a reversal right after a receipt restores the earlier state exactly', () => {
    const r = replay(EMPTY_STATE, [
      { kind: 'set', targetQuantity: '100', targetCost: '90' },
      { kind: 'in', quantity: '50', incomingCost: '96' },
      { kind: 'reverse', quantityChange: '50', valueChange: '4800' },
    ]);
    expect(s(r.lines, 2)).toMatchObject({ q: '100', cost: '90.0000', value: '9000.00' });
  });
});

describe('back-dating re-costs later lines (4.9)', () => {
  it('inserting an earlier receipt changes the cost of a later issue', () => {
    const original: StockIntent[] = [
      { kind: 'in', quantity: '10', incomingCost: '100' },
      { kind: 'out', quantity: '5' },
    ];
    expect(replay(EMPTY_STATE, original).lines[1].valueChange.toFixed(2)).toBe('-500.00');
    const withBackdated: StockIntent[] = [original[0], { kind: 'in', quantity: '10', incomingCost: '120' }, original[1]];
    expect(replay(EMPTY_STATE, withBackdated).lines[2].valueChange.toFixed(2)).toBe('-550.00');
  });
});

describe('negative stock and missing cost', () => {
  it('reports the lowest quantity reached', () => {
    const r = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '5', incomingCost: '10' },
      { kind: 'out', quantity: '8' },
      { kind: 'in', quantity: '10', incomingCost: '10' },
    ]);
    expect(lowestQuantity(EMPTY_STATE, r.lines).toString()).toBe('-3');
  });

  it('an issue from nothing needs a fallback cost', () => {
    expect(() => apply(EMPTY_STATE, { kind: 'out', quantity: '1' })).toThrow('MISSING_COST');
    const r = apply(EMPTY_STATE, { kind: 'out', quantity: '1' }, '40');
    expect(r.after.quantity.toString()).toBe('-1');
    expect(r.valueChange.toFixed(2)).toBe('-40.00');
  });

  it('a receipt into negative stock takes the incoming cost', () => {
    const r = apply({ quantity: d('-2'), unitCost: d('40'), value: d('-80') }, { kind: 'in', quantity: '5', incomingCost: '50' });
    expect(r.after.quantity.toString()).toBe('3');
    expect(r.after.unitCost.toFixed(4)).toBe('50.0000');
    expect(r.after.value.toFixed(2)).toBe('150.00');
  });
});

describe('batches', () => {
  it('works out expiry from shelf life and is usable through its expiry day', () => {
    expect(expiryFromShelfLife('2026-10-01', 30)).toBe('2026-10-31');
    expect(isExpiredOn('2026-10-31', '2026-10-31')).toBe(false);
    expect(isExpiredOn('2026-10-31', '2026-11-01')).toBe(true);
    expect(isExpiredOn(null, '2099-01-01')).toBe(false);
  });
});

import { Decimal } from './rounding.js';
function d(v: string) {
  return new Decimal(v);
}

describe('audit 3 (28 October 2026): costing edge cases', () => {
  it('a fixed-cost out that empties the shelf takes the whole remaining value, so the shelf matches its movements', () => {
    // 5 @ 80, 10 @ 100, 5 sold at the average, then the 10 left go back to the supplier at the receipt's 100.
    const r = replay(EMPTY_STATE, [
      { kind: 'in', quantity: '5', incomingCost: '80' },
      { kind: 'in', quantity: '10', incomingCost: '100' },
      { kind: 'out', quantity: '5' },
      { kind: 'out', quantity: '10', fixedCost: '100' },
    ]);
    const total = r.lines.reduce((s, l) => s.add(l.valueChange), d('0'));
    expect(r.end.quantity.toString()).toBe('0');
    expect(r.end.value.toString()).toBe('0');
    expect(total.toFixed(2)).toBe('0.00');
    expect(r.lines[3].valueChange.toFixed(2)).toBe('-933.33');
  });

  it('free goods in stock (cost 0) are sold at 0, not at the fallback cost', () => {
    const r = replay(EMPTY_STATE, [{ kind: 'in', quantity: '10', incomingCost: '0' }, { kind: 'out', quantity: '3' }], '50');
    expect(r.lines[1].valueChange.toFixed(2)).toBe('0.00');
    expect(r.end.value.toFixed(2)).toBe('0.00');
    // Beyond stock with no cost known, the fallback cost still applies.
    expect(apply(EMPTY_STATE, { kind: 'out', quantity: '1' }, '50').valueChange.toFixed(2)).toBe('-50.00');
  });
});
