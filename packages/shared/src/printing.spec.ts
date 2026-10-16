// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { gtinCheckDigit } from './barcodes.js';
import { amountInWords, barcodeModules, CODE128_WIDTHS, code128Modules, code128Values, ean13Modules, ean8Modules, indianNumberInWords, LABEL_SIZES, labelsPerSheet } from './printing.js';

describe('amount in words (scenario 10.1)', () => {
  it('uses lakh and crore, with paise', () => {
    expect(amountInWords('123450.25')).toBe('Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only');
    expect(amountInWords('0.50')).toBe('Fifty Paise Only');
    expect(amountInWords('0')).toBe('Rupees Zero Only');
    expect(amountInWords('1000')).toBe('Rupees One Thousand Only');
    expect(amountInWords('2500000')).toBe('Rupees Twenty-Five Lakh Only');
    expect(amountInWords('-62')).toBe('Minus Rupees Sixty-Two Only');
  });
  it('counts crores above ninety-nine', () => {
    expect(indianNumberInWords(1234567890n)).toBe('One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety');
    expect(indianNumberInWords(101)).toBe('One Hundred One');
    expect(indianNumberInWords(10_000_000)).toBe('One Crore');
  });
});

/** Reads EAN-13 bars back to digits, independently of the encoder's tables' order (scenario 10.4). */
function decodeEan13(modules: string): string {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const flip = (p: string) => [...p].map((b) => (b === '1' ? '0' : '1')).join('');
  const G = L.map((p) => [...flip(p)].reverse().join(''));
  const R = L.map(flip);
  expect(modules.slice(0, 3)).toBe('101');
  expect(modules.slice(45, 50)).toBe('01010');
  expect(modules.slice(92)).toBe('101');
  let parity = '';
  let left = '';
  for (let i = 0; i < 6; i++) {
    const chunk = modules.slice(3 + i * 7, 10 + i * 7);
    const l = L.indexOf(chunk);
    const g = G.indexOf(chunk);
    parity += l >= 0 ? 'L' : 'G';
    left += l >= 0 ? l : g;
  }
  let right = '';
  for (let i = 0; i < 6; i++) right += R.indexOf(modules.slice(50 + i * 7, 57 + i * 7));
  const first = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'].indexOf(parity);
  return `${first}${left}${right}`;
}

describe('barcodes', () => {
  it('EAN-13 bars decode back to the same digits', () => {
    for (const code of ['8901234567890', '0012345678905', '4006381333931']) {
      const m = ean13Modules(code);
      expect(m).toHaveLength(95);
      expect(decodeEan13(m)).toBe(code);
    }
    expect(decodeEan13(ean13Modules('890123456789'))).toBe(`890123456789${gtinCheckDigit('890123456789')}`);
    expect(() => ean13Modules('8901234567893')).toThrow(/check digit/);
  });
  it('EAN-8 has 67 modules', () => {
    expect(ean8Modules('96385074')).toHaveLength(67);
  });
  it('every Code 128 symbol has the right width and is unique', () => {
    expect(CODE128_WIDTHS).toHaveLength(107);
    for (const [i, w] of CODE128_WIDTHS.entries()) {
      expect([...w].reduce((s, x) => s + Number(x), 0)).toBe(i === 106 ? 13 : 11);
    }
    expect(new Set(CODE128_WIDTHS).size).toBe(107);
  });
  it('Code 128 uses set C for even digits and adds the check symbol', () => {
    expect(code128Values('1234')).toEqual([105, 12, 34, (105 + 12 * 1 + 34 * 2) % 103, 106]);
    expect(code128Values('ITM-1')[0]).toBe(104);
    const m = code128Modules('ITM-000002');
    // Start, 10 characters, check, stop: 12 × 11 + 13 modules.
    expect(m).toHaveLength(12 * 11 + 13);
    expect(m.startsWith('11')).toBe(true);
    expect(m.endsWith('11')).toBe(true);
  });
  it('codes that are not EAN print as Code 128', () => {
    expect(barcodeModules('ITM-000002', 'other').symbology).toBe('CODE128');
    expect(barcodeModules('012345678905', 'UPCA')).toMatchObject({ symbology: 'EAN13', text: '012345678905' });
  });
});

describe('labels', () => {
  it('the standard sheets fit their labels on A4', () => {
    for (const s of LABEL_SIZES.filter((x) => x.media === 'sheet')) {
      const fit = labelsPerSheet(s);
      expect(fit.across).toBeGreaterThanOrEqual(s.across!);
      expect(fit.down).toBeGreaterThanOrEqual(s.down!);
    }
    expect(labelsPerSheet({ width: 50, height: 25, marginTop: 10, marginLeft: 5 })).toEqual({ across: 4, down: 11, perSheet: 44 });
  });
});
