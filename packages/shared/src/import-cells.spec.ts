// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { excelSerialToIso, readDate, readDayMonth, readNumber, readText, readYesNo } from './import-cells.js';

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

describe('reading birthdays and anniversaries (plan 11 C10)', () => {
  const today = '2026-10-16';
  it('reads a full date into the year and day-month, or a day and month alone', () => {
    for (const t of ['15-08-1990', '15/08/1990', '15 Aug 1990', '1990-08-15', '15/08/90']) expect(readDayMonth(t, today)).toEqual({ ok: true, value: '1990-08-15' });
    for (const t of ['15-08', '15/8', '15.08', '15 Aug', '15-August']) expect(readDayMonth(t, today)).toEqual({ ok: true, value: '08-15' });
    expect(readDayMonth('29-02', today)).toEqual({ ok: true, value: '02-29' });
    expect(readDayMonth(33100, today)).toEqual({ ok: true, value: excelSerialToIso(33100) });
  });
  it('refuses what is not a real day, a future date, or a year before 1900', () => {
    expect(readDayMonth('31-02', today)).toMatchObject({ ok: false, problem: '"31-02": not a real day and month' });
    expect(readDayMonth('08-15', today)).toMatchObject({ ok: false });
    expect(readDayMonth('15-08-2030', today)).toMatchObject({ ok: false, problem: '"15-08-2030": the year must be between 1900 and 2026' });
    expect(readDayMonth('20-10-2026', today)).toMatchObject({ ok: false, problem: '"20-10-2026": the date is in the future' });
    expect(readDayMonth('01-01-1850', today)).toMatchObject({ ok: false });
    expect(readDayMonth('someday', today)).toMatchObject({ ok: false, problem: '"someday" is not a date; write it as 15/08/1990 or 15/08' });
  });
});
