// Copyright (c) 2026, Rademics. All rights reserved.
// Printing helpers (plan 10 §4): the amount in words in Indian style, barcode
// bars for labels (EAN-13, EAN-8 and Code 128, all public standards, drawn by
// our own code), and how many labels fit on a sheet.
import { type BarcodeType, gtinCheckDigit } from './barcodes.js';
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

// ---- Amount in words (blueprint 16 "Calculations") ----

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/**
 * Audit 6: an amount written the Indian way, 1,25,000.00 (rounded to paise; no ₹ sign).
 * Worked on the decimal text, never through a float.
 */
export function indianAmount(amount: DecimalInput): string {
  const fixed = roundMoney(new Decimal(amount)).toFixed(2);
  const negative = fixed.startsWith('-') && /[1-9]/.test(fixed);
  const [whole, paise] = fixed.replace(/^-/, '').split('.');
  const grouped = whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`;
  return `${negative ? '-' : ''}${grouped}.${paise}`;
}

/** A whole number in words with Indian grouping: thousand, lakh, crore. */
export function indianNumberInWords(value: number | bigint): string {
  let n = BigInt(value);
  if (n === 0n) return 'Zero';
  if (n < 0n) return `Minus ${indianNumberInWords(-n)}`;
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  n %= 10_000_000n;
  if (crore > 0n) parts.push(`${indianNumberInWords(crore)} Crore`);
  const lakh = Number(n / 100_000n);
  n %= 100_000n;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Number(n / 1000n);
  n %= 1000n;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n > 0n) parts.push(belowThousand(Number(n)));
  return parts.join(' ');
}

/** "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only". */
export function amountInWords(amount: DecimalInput): string {
  const value = roundMoney(amount);
  const negative = value.lt(0);
  const abs = value.abs();
  const rupees = BigInt(abs.floor().toFixed(0));
  const paise = Number(abs.sub(abs.floor()).mul(100).toFixed(0));
  let text: string;
  if (rupees === 0n && paise > 0) text = `${belowHundred(paise)} Paise`;
  else text = `Rupees ${indianNumberInWords(rupees)}${paise > 0 ? ` and ${belowHundred(paise)} Paise` : ''}`;
  return `${negative ? 'Minus ' : ''}${text} Only`;
}

// ---- Barcodes ----

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
/** The first digit of an EAN-13 sets which of the left six digits use the G set. */
const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 as 95 modules ("1" = bar). The check digit is worked out when 12 digits are given. */
export function ean13Modules(code: string): string {
  const digits = code.length === 12 ? code + gtinCheckDigit(code) : code;
  if (!/^\d{13}$/.test(digits)) throw new Error('An EAN-13 needs 12 or 13 digits');
  if (Number(digits[12]) !== gtinCheckDigit(digits.slice(0, 12))) throw new Error('The EAN-13 check digit is wrong');
  const parity = EAN13_PARITY[Number(digits[0])];
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(digits[i])];
  out += '01010';
  for (let i = 7; i <= 12; i++) out += EAN_R[Number(digits[i])];
  return `${out}101`;
}

/** EAN-8 as 67 modules. */
export function ean8Modules(code: string): string {
  const digits = code.length === 7 ? code + gtinCheckDigit(code) : code;
  if (!/^\d{8}$/.test(digits)) throw new Error('An EAN-8 needs 7 or 8 digits');
  if (Number(digits[7]) !== gtinCheckDigit(digits.slice(0, 7))) throw new Error('The EAN-8 check digit is wrong');
  let out = '101';
  for (let i = 0; i < 4; i++) out += EAN_L[Number(digits[i])];
  out += '01010';
  for (let i = 4; i < 8; i++) out += EAN_R[Number(digits[i])];
  return `${out}101`;
}

/** Bar and space widths of every Code 128 symbol (values 0–106; 106 is the stop, 7 widths). */
export const CODE128_WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104;
const START_C = 105;
const STOP = 106;

/** The Code 128 symbol values for a text: set C for an even run of digits, otherwise set B. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Nothing to encode');
  let values: number[];
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    values = [START_C];
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error(`"${ch}" cannot be printed in a barcode`);
      values.push(c - 32);
    }
  }
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check, STOP];
}

/** Code 128 as modules ("1" = bar). */
export function code128Modules(text: string): string {
  let out = '';
  for (const v of code128Values(text)) {
    const widths = CODE128_WIDTHS[v];
    for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  }
  return out;
}

/** Bars for a label: EAN-13/UPC-A/EAN-8 in their own symbology, everything else as Code 128 (scans to the same text). */
export function barcodeModules(code: string, type: BarcodeType): { symbology: 'EAN13' | 'EAN8' | 'CODE128'; modules: string; text: string } {
  if (type === 'EAN13') return { symbology: 'EAN13', modules: ean13Modules(code), text: code };
  if (type === 'UPCA') return { symbology: 'EAN13', modules: ean13Modules(`0${code}`), text: code };
  if (type === 'EAN8') return { symbology: 'EAN8', modules: ean8Modules(code), text: code };
  return { symbology: 'CODE128', modules: code128Modules(code), text: code };
}

// ---- Labels (plan 10 §1.B) ----

export interface LabelSize {
  key: string;
  name: string;
  /** Label size in millimetres. */
  width: number;
  height: number;
  /** sheet: A4 sticker sheet; roll: one label per printed page on a label printer. */
  media: 'sheet' | 'roll';
  /** Sheet layout (A4, mm). */
  across?: number;
  down?: number;
  marginTop?: number;
  marginLeft?: number;
  gapX?: number;
  gapY?: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { key: 'a4-65', name: 'A4 sheet, 65 labels (38 × 21 mm)', width: 38.1, height: 21.2, media: 'sheet', across: 5, down: 13, marginTop: 10.7, marginLeft: 4.7, gapX: 2.5, gapY: 0 },
  { key: 'a4-24', name: 'A4 sheet, 24 labels (64 × 34 mm)', width: 63.5, height: 33.9, media: 'sheet', across: 3, down: 8, marginTop: 12.9, marginLeft: 7.2, gapX: 2.5, gapY: 0 },
  { key: 'roll-50x25', name: 'Label roll, 50 × 25 mm', width: 50, height: 25, media: 'roll' },
  { key: 'roll-38x25', name: 'Label roll, 38 × 25 mm', width: 38, height: 25, media: 'roll' },
];

/** How many labels of a size fit across and down an A4 sheet (210 × 297 mm) with the given margins and gaps. */
export function labelsPerSheet(s: { width: number; height: number; marginTop?: number; marginLeft?: number; gapX?: number; gapY?: number }): { across: number; down: number; perSheet: number } {
  const mt = s.marginTop ?? 10;
  const ml = s.marginLeft ?? 5;
  const gx = s.gapX ?? 0;
  const gy = s.gapY ?? 0;
  // A hair of tolerance so a sheet made to fit exactly is not one short through rounding.
  const across = Math.max(0, Math.floor((210 - 2 * ml + gx) / (s.width + gx) + 1e-6));
  const down = Math.max(0, Math.floor((297 - 2 * mt + gy) / (s.height + gy) + 1e-6));
  return { across, down, perSheet: across * down };
}

/** Amounts on prints: returns shown as plain numbers marked as returned (blueprint 16). */
export function plainAmount(value: DecimalInput): { amount: Decimal; returned: boolean } {
  const d = new Decimal(value);
  return { amount: d.abs(), returned: d.lt(0) };
}
