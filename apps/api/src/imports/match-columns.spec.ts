// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { type Field, matchColumns } from './importers.js';

const customers: Field[] = [
  { key: 'code', label: 'Customer code', type: 'code' },
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'mobile', label: 'Mobile', type: 'code' },
  { key: 'gstin', label: 'GSTIN', type: 'code' },
  { key: 'pincode', label: 'PIN code', type: 'code' },
];
const prices: Field[] = [
  { key: 'item', label: 'Item code', type: 'code' },
  { key: 'code', label: 'Price list code', type: 'code' },
  { key: 'price', label: 'Price', type: 'number' },
];

describe('matchColumns with headings from other software', () => {
  // Launch check, 27 October 2026: an export from another program had to be matched column by column.
  it('matches common headings such as Party Name, Contact No, GSTIN/UIN and Pincode', () => {
    const r = matchColumns(['Party Name', 'Contact No', 'GSTIN/UIN', 'Pincode', 'Remarks'], customers);
    expect(r.columns).toEqual(['name', 'mobile', 'gstin', 'pincode', null]);
    expect(r.unmatched).toEqual(['Remarks']);
  });

  it("a field's own label wins over a common heading", () => {
    // "Item Code" is a common heading for code, but in the prices file it is the item column.
    expect(matchColumns(['Item Code', 'Rate'], prices).columns).toEqual(['item', 'price']);
  });
});
