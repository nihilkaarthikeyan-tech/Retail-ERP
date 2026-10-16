// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { excelSerialToIso, readDate, readNumber, readText, readYesNo } from './import-cells.js';

describe('reading numbers (scenario 10.6)', () => {
  it('reads Indian and international grouping, rupee signs and spreadsheet numbers', () => {
    expect(readNumber('1,05,000.50')).toEqual({ ok: true, value: '105000.50' });
    expect(readNumber('105,000.50')).toEqual({ ok: true, value: '105000.50' });
    expect(readNumber('₹ 1,200')).toEqual({ ok: true, value: '1200' });
    expect(readNumber('-45')).toEqual({ ok: true, value: '-45' });
    expect(readNumber(62.1)).toEqual({ ok: true, value: '62.1' });
    expect(readNumber(0.1 + 0.2)).toEqual({ ok: true, value: '0.3' });
  });
  it('reports what it cannot read', () => {
    expect(readNumber('1,0,5')).toMatchObject({ ok: false });
    expect(readNumber('abc')).toMatchObject({ ok: false });
    expect(readNumber('')).toMatchObject({ ok: false, problem: 'is empty' });
  });
});

describe('reading dates', () => {
  it('reads day-first dates in common styles and spreadsheet dates', () => {
    for (const t of ['2026-10-16', '16/10/2026', '16-10-2026', '16.10.2026', '16-Oct-2026', '16 Oct 2026', '16 October 2026', '16/10/26']) expect(readDate(t)).toEqual({ ok: true, value: '2026-10-16' });
    expect(readDate(46311)).toEqual({ ok: true, value: excelSerialToIso(46311) });
    expect(excelSerialToIso(45748)).toBe('2025-04-01');
  });
  it('refuses unclear or impossible dates', () => {
    expect(readDate('10/16/2026')).toMatchObject({ ok: false });
    expect(readDate('31/02/2026')).toMatchObject({ ok: false });
    expect(readDate('next week')).toMatchObject({ ok: false });
  });
});

describe('reading text', () => {
  it('keeps codes as typed and spots lost leading zeros', () => {
    expect(readText('0012345678905')).toEqual({ ok: true, value: '0012345678905' });
    expect(readText('0902')).toEqual({ ok: true, value: '0902' });
    expect(readText(12345678905, { digitsLength: [8, 12, 13, 14] })).toMatchObject({ ok: false });
    expect(readText(8901234567890, { digitsLength: [8, 12, 13, 14] })).toEqual({ ok: true, value: '8901234567890' });
  });
  it('reads yes and no', () => {
    expect(readYesNo('Yes')).toEqual({ ok: true, value: true });
    expect(readYesNo('')).toEqual({ ok: true, value: false });
    expect(readYesNo('maybe')).toMatchObject({ ok: false });
  });
});
