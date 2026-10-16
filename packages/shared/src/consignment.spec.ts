// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { allocateConsignment, consignmentAmount, type ConsignmentEvent, unsettledSold } from './consignment.js';

const view = (m: ReturnType<typeof allocateConsignment>) =>
  Object.fromEntries([...m.values()].map((l) => [l.lineId, { received: l.received.toString(), returned: l.returned.toString(), sold: l.sold.toString(), held: l.held.toString() }]));

describe('allocateConsignment', () => {
  it('scenario 11.23: 20 received, 8 sold, 1 returned by a customer, 3 back to the supplier', () => {
    const events: ConsignmentEvent[] = [
      { kind: 'receipt', at: 1, lineId: 'a', supplierId: 'fw', rate: '300', accepted: '20' },
      { kind: 'till', at: 2, quantity: '-5' },
      { kind: 'till', at: 3, quantity: '-3' },
      { kind: 'till', at: 4, quantity: '1' },
      { kind: 'supplier_return', at: 5, lineId: 'a', accepted: '3' },
    ];
    expect(view(allocateConsignment(events))).toEqual({ a: { received: '20', returned: '3', sold: '7', held: '10' } });
  });

  it('sales use up sale-or-return goods before the shop’s own stock, oldest layer first', () => {
    const m = allocateConsignment([
      { kind: 'receipt', at: 1, lineId: 'old', supplierId: 's1', rate: '100', accepted: '2' },
      { kind: 'receipt', at: 2, lineId: 'new', supplierId: 's2', rate: '120', accepted: '5' },
      { kind: 'till', at: 3, quantity: '-4' },
    ]);
    expect(view(m)).toEqual({ old: { received: '2', returned: '0', sold: '2', held: '0' }, new: { received: '5', returned: '0', sold: '2', held: '3' } });
  });

  it('sales beyond the sale-or-return goods come from own stock and are not counted', () => {
    const m = allocateConsignment([
      { kind: 'till', at: 0, quantity: '-10' },
      { kind: 'receipt', at: 1, lineId: 'a', supplierId: 's', rate: '50', accepted: '3' },
      { kind: 'till', at: 2, quantity: '-5' },
    ]);
    expect(view(m).a).toEqual({ received: '3', returned: '0', sold: '3', held: '0' });
  });

  it('a till return gives back the most recently used-up units first', () => {
    const m = allocateConsignment([
      { kind: 'receipt', at: 1, lineId: 'a', supplierId: 's1', rate: '10', accepted: '1' },
      { kind: 'receipt', at: 2, lineId: 'b', supplierId: 's2', rate: '11', accepted: '1' },
      { kind: 'till', at: 3, quantity: '-2' },
      { kind: 'till', at: 4, quantity: '1' },
      { kind: 'till', at: 5, quantity: '5' },
    ]);
    expect(view(m)).toEqual({ a: { received: '1', returned: '0', sold: '0', held: '1' }, b: { received: '1', returned: '0', sold: '0', held: '1' } });
  });

  it('a return to the supplier takes its own line first, then the same supplier’s newer layers; rejected goods are never sold', () => {
    const m = allocateConsignment([
      { kind: 'receipt', at: 1, lineId: 'a', supplierId: 's', rate: '10', accepted: '2', rejected: '1' },
      { kind: 'receipt', at: 2, lineId: 'b', supplierId: 's', rate: '10', accepted: '4' },
      { kind: 'till', at: 3, quantity: '-2' },
      { kind: 'supplier_return', at: 4, lineId: 'a', accepted: '3', rejected: '1' },
    ]);
    expect(view(m)).toEqual({ a: { received: '3', returned: '1', sold: '2', held: '0' }, b: { received: '4', returned: '3', sold: '0', held: '1' } });
  });

  it('at the same instant a receipt comes before a sale', () => {
    const m = allocateConsignment([
      { kind: 'till', at: 1, quantity: '-1' },
      { kind: 'receipt', at: 1, lineId: 'a', supplierId: 's', rate: '10', accepted: '1' },
    ]);
    expect(view(m).a.sold).toBe('1');
  });
});

describe('unsettledSold and consignmentAmount', () => {
  it('bills only what no earlier statement billed, never below zero', () => {
    expect(unsettledSold('7', '0').toString()).toBe('7');
    expect(unsettledSold('7', '7').toString()).toBe('0');
    expect(unsettledSold('6', '7').toString()).toBe('0');
    expect(unsettledSold('9', '7').toString()).toBe('2');
  });
  it('amount = sold × rate to the paisa', () => {
    expect(consignmentAmount('7', '300').toFixed(2)).toBe('2100.00');
    expect(consignmentAmount('3', '33.3333').toFixed(2)).toBe('100.00');
    expect(consignmentAmount('0.5', '0.0150').toFixed(2)).toBe('0.01');
  });
});
