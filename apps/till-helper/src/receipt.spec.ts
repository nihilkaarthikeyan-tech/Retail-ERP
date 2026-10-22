// Copyright (c) 2026, Rademics. All rights reserved.
/* eslint-disable no-control-regex -- printer commands are control characters */
import { describe, expect, it } from 'vitest';
import { buildReceipt, checkReceipt, indianDateTime, type Receipt } from './receipt.js';
import { sampleSale } from './test-support/sample-receipt.js';

// Expected printer commands, written out byte by byte.
const INIT = [0x1b, 0x40, 0x1b, 0x74, 0x00];
const CENTRE = [0x1b, 0x61, 0x01];
const LEFT = [0x1b, 0x61, 0x00];
const BOLD_ON = [0x1b, 0x45, 0x01];
const BOLD_OFF = [0x1b, 0x45, 0x00];
const DOUBLE_HEIGHT = [0x1d, 0x21, 0x01];
const NORMAL_SIZE = [0x1d, 0x21, 0x00];
const FEED_4_AND_CUT = [0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00];

/** A text line as the printer receives it: ASCII bytes and a line feed. */
const t = (s: string) => [...Buffer.from(s, 'ascii'), 0x0a];
/** Left text and right text filling exactly `w` characters. */
const row = (left: string, right: string, w: number) => {
  const pad = w - left.length - right.length;
  expect(pad).toBeGreaterThan(0);
  return left + ' '.repeat(pad) + right;
};

function asText(buf: Buffer): string[] {
  // Printable lines only (commands removed), for layout checks.
  return buf
    .toString('latin1')
    .replace(/\x1b@/g, '')
    .replace(/\x1b[Ead]./g, '')
    .replace(/\x1bt./g, '')
    .replace(/\x1d!./g, '')
    .replace(/\x1dVB./g, '')
    .split('\n');
}

describe('receipt for scenario 6.1 (cash sale, 80 mm paper)', () => {
  it('matches the expected bytes exactly', () => {
    const w = 48;
    const rule = '-'.repeat(w);
    const expected = [
      ...INIT,
      ...CENTRE,
      ...BOLD_ON,
      ...t('Bazaar Anna Nagar'),
      ...BOLD_OFF,
      ...t('Rademics Retail Private Limited'),
      ...t('GSTIN: 33AABCR1234F1Z5'),
      ...t('12, 2nd Avenue, Anna Nagar, Chennai 600040'),
      ...t('Phone: 044 2626 1234'),
      ...t(''),
      ...BOLD_ON,
      ...t('TAX INVOICE'),
      ...BOLD_OFF,
      ...LEFT,
      ...t(row('Bill: S1-T1-000123', 'Till: T1', w)),
      ...t('Date: 15-10-2026 10:30'),
      ...t(rule),
      ...t(row('Item', 'Amount', w)),
      ...t(rule),
      ...t('Basmati Rice 1 kg'),
      ...t(row('  2 x 120.00', '240.00', w)),
      ...t('  Code RICE-BAS-1KG, HSN 1006'),
      ...t('Surf Excel 1 kg'),
      ...t(row('  1 x 132.00', '132.00', w)),
      ...t('  Code SURF-1KG, HSN 3402'),
      ...t(rule),
      ...t('GST'.padEnd(6) + 'Taxable'.padStart(14) + 'CGST'.padStart(14) + 'SGST'.padStart(14)),
      ...t('5%'.padEnd(6) + '228.57'.padStart(14) + '5.72'.padStart(14) + '5.71'.padStart(14)),
      ...t('18%'.padEnd(6) + '111.86'.padStart(14) + '10.07'.padStart(14) + '10.07'.padStart(14)),
      ...t(rule),
      ...t(row('Gross', '372.00', w)),
      ...t(row('Taxable value', '340.43', w)),
      ...BOLD_ON,
      ...DOUBLE_HEIGHT,
      ...t(row('TOTAL', 'Rs. 372.00', w)),
      ...NORMAL_SIZE,
      ...BOLD_OFF,
      ...t(rule),
      ...t(row('Cash', 'Rs. 500.00', w)),
      ...t(row('Change', 'Rs. 128.00', w)),
      ...t(''),
      ...CENTRE,
      ...t('Thank you! Visit again.'),
      ...LEFT,
      ...FEED_4_AND_CUT,
    ];
    const actual = buildReceipt(sampleSale(), 80);
    expect([...actual]).toEqual(expected);
  });

  it('never prints a line wider than 48 characters and uses only printable ASCII', () => {
    const buf = buildReceipt(sampleSale(), 80);
    for (const line of asText(buf)) {
      expect(line.length).toBeLessThanOrEqual(48);
      expect(line).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

describe('receipt on 58 mm paper (32 characters)', () => {
  it('wraps the header and fits the GST table in 32 columns', () => {
    const lines = asText(buildReceipt(sampleSale(), 58));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines).toContain('12, 2nd Avenue, Anna Nagar,');
    expect(lines).toContain('Chennai 600040');
    expect(lines).toContain(row('Bill: S1-T1-000123', 'Till: T1', 32));
    expect(lines).toContain('GST'.padEnd(5) + 'Taxable'.padStart(9) + 'CGST'.padStart(9) + 'SGST'.padStart(9));
    expect(lines).toContain('5%'.padEnd(5) + '228.57'.padStart(9) + '5.72'.padStart(9) + '5.71'.padStart(9));
    expect(lines).toContain('18%'.padEnd(5) + '111.86'.padStart(9) + '10.07'.padStart(9) + '10.07'.padStart(9));
    expect(lines).toContain(row('TOTAL', 'Rs. 372.00', 32));
    expect(lines).toContain(row('Change', 'Rs. 128.00', 32));
  });

  it('switches the GST table to one block per rate when the amounts do not fit', () => {
    const r = sampleSale();
    r.gstTable = [{ rate: '18', taxable: '1234567.89', cgst: '111111.11', sgst: '111111.11', igst: '0.00' }];
    const lines = asText(buildReceipt(r, 58));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines).toContain(row('GST 18% taxable', '1234567.89', 32));
    expect(lines).toContain(row('  CGST', '111111.11', 32));
    expect(lines).toContain(row('  SGST', '111111.11', 32));
  });

  it('wraps a long item name and its serial numbers', () => {
    const r = sampleSale();
    r.lines = [
      {
        name: 'Extra Long Product Name For A Mobile Phone Charger 65W',
        quantity: '1',
        price: '1499.00',
        amount: '1499.00',
        serials: ['SN-000111222333', 'SN-000111222334'],
      },
    ];
    const lines = asText(buildReceipt(r, 58));
    expect(lines).toContain('Extra Long Product Name For A');
    expect(lines).toContain('Mobile Phone Charger 65W');
    expect(lines).toContain(row('  1 x 1499.00', '1499.00', 32));
    expect(lines).toContain('  S/N: SN-000111222333,');
    expect(lines).toContain('  SN-000111222334');
  });
});

describe('receipt variants', () => {
  it('prints ₹ as "Rs." and marks duplicates and older provisional bills', () => {
    const r = sampleSale();
    r.duplicate = true;
    r.provisional = true;
    r.footer = 'Prices in ₹ include GST';
    const lines = asText(buildReceipt(r, 80));
    expect(lines).toContain('TAX INVOICE');
    expect(lines).toContain('DUPLICATE');
    expect(lines).toContain('GST provisional (an older bill)');
    expect(lines).toContain('Prices in Rs. include GST');
  });

  it('prints the cashier and customer when the till sends them', () => {
    const lines = asText(buildReceipt({ ...sampleSale(), cashier: 'Priya', customer: 'Ravi Kumar' }, 80));
    expect(lines).toContain('Cashier: Priya');
    expect(lines).toContain('Customer: Ravi Kumar');
  });

  it('prints a return as a credit note with refund lines', () => {
    const r: Receipt = {
      ...sampleSale(),
      kind: 'return',
      number: 'R1-T1-000007',
      lines: [{ name: 'Surf Excel 1 kg', quantity: '1', price: '132.00', amount: '132.00', discount: '10.00' }],
      totals: { total: '122.00', rounding: '0.00' },
      payments: [{ method: 'UPI', amount: '122.00', reference: 'UPI-REF-9988' }],
      change: null,
    };
    const lines = asText(buildReceipt(r, 80));
    expect(lines).toContain('CREDIT NOTE / RETURN');
    expect(lines).toContain(row('Credit note: R1-T1-000007', 'Till: T1', 48));
    expect(lines).toContain(row('  Discount', '-10.00', 48));
    expect(lines).toContain(row('REFUND', 'Rs. 122.00', 48));
    expect(lines).toContain(row('Refund by UPI', 'Rs. 122.00', 48));
    expect(lines).toContain('  Ref: UPI-REF-9988');
    expect(lines.some((l) => l.startsWith('Change'))).toBe(false);
  });

  it('marks free items and shows IGST when the sale is between states', () => {
    const r = sampleSale();
    r.lines[1] = { ...r.lines[1]!, free: true, amount: '0.00' };
    r.gstTable = [{ rate: '5', taxable: '228.57', cgst: '0.00', sgst: '0.00', igst: '11.43' }];
    const lines = asText(buildReceipt(r, 80));
    expect(lines).toContain(row('  1 x 132.00', 'FREE', 48));
    expect(lines).toContain('GST'.padEnd(6) + 'Taxable'.padStart(21) + 'IGST'.padStart(21));
    expect(lines).toContain('5%'.padEnd(6) + '228.57'.padStart(21) + '11.43'.padStart(21));
  });
});

describe('dates in Indian time', () => {
  it('puts 00:05 in India on 1 April on 1 April, not 31 March (UTC)', () => {
    expect(indianDateTime('2026-03-31T18:35:00.000Z')).toBe('01-04-2026 00:05');
  });
});

describe('checkReceipt', () => {
  it('accepts the sample receipt', () => {
    expect(checkReceipt(sampleSale()).ok).toBe(true);
  });
  it('refuses a receipt with missing or wrong fields', () => {
    expect(checkReceipt(null).ok).toBe(false);
    expect(checkReceipt({ ...sampleSale(), kind: 'quote' }).ok).toBe(false);
    expect(checkReceipt({ ...sampleSale(), totals: {} }).ok).toBe(false);
    expect(checkReceipt({ ...sampleSale(), lines: [{ name: 'X', quantity: '1', price: '1', amount: {} }] }).ok).toBe(false);
    expect(checkReceipt({ ...sampleSale(), store: {} }).ok).toBe(false);
  });
});

describe('plan 08: GST details on the receipt', () => {
  const gst = {
    title: 'Tax invoice',
    invoiceKind: 'business',
    sellerGstin: '33AAACR1234A1ZV',
    buyer: { name: 'Kaveri Traders', gstin: '29AABCK1234A1Z5', address: '12 MG Road, Bengaluru', state: { code: '29', name: 'Karnataka' } },
    placeOfSupply: { code: '29', name: 'Karnataka' },
    reverseCharge: false,
    original: null,
    declaration: null,
    creditNoteLate: false,
  };
  it('prints the title, buyer GSTIN, place of supply and reverse charge of a business invoice', () => {
    const r: Receipt = { ...sampleSale(), gst };
    expect(checkReceipt(r).ok).toBe(true);
    const lines = asText(buildReceipt(r, 80));
    expect(lines).toContain('TAX INVOICE');
    expect(lines).toContain('GSTIN: 33AAACR1234A1ZV');
    expect(lines).toContain('Buyer GSTIN: 29AABCK1234A1Z5');
    expect(lines).toContain('Place of supply: Karnataka (29)');
    expect(lines).toContain('Reverse charge: No');
    expect(lines).toContain('Authorised signatory');
  });
  it('prints a bill of supply with its declaration and a credit note with the original bill', () => {
    const bos = asText(buildReceipt({ ...sampleSale(), gst: { ...gst, title: 'Bill of supply', invoiceKind: 'bill_of_supply', buyer: null, declaration: 'Composition taxable person, not eligible to collect tax on supplies' } }, 80));
    expect(bos).toContain('BILL OF SUPPLY');
    expect(bos.join(' ')).toMatch(/Composition taxable person, not eligible to collect tax/);
    const cn = asText(buildReceipt({ ...sampleSale(), kind: 'return', gst: { ...gst, title: 'Credit note', invoiceKind: 'consumer', buyer: null, original: { number: 'MAIN-T1-2026-27-000001', date: '2026-10-18' }, creditNoteLate: true } }, 80));
    expect(cn).toContain('CREDIT NOTE');
    expect(cn.join(' ')).toMatch(/Against bill MAIN-T1-2026-27-000001\s+dated 2026-10-18/);
    expect(cn.join(' ')).toMatch(/after the GST time limit/);
  });
  it('refuses a GST block without a title', () => {
    expect(checkReceipt({ ...sampleSale(), gst: { title: '' } }).ok).toBe(false);
    expect(checkReceipt({ ...sampleSale(), gst: { title: 'Tax invoice', reverseCharge: 'no' } }).ok).toBe(false);
  });
});

describe('plan 13: gift cards and loyalty points', () => {
  const BARCODE_16 = [0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x66, 0, 0x1d, 0x6b, 73, 10, 0x7b, 0x43, 61, 23, 45, 67, 89, 1, 23, 45, 0x0a];

  function giftCardSale(): Receipt {
    return {
      ...sampleSale(),
      number: 'GC-2026-27-00001',
      title: 'Gift card receipt',
      footer: null,
      gst: null,
      lines: [{ name: 'Gift card (new)', code: '', hsn: null, quantity: '1', price: '1000.00', discount: '0.00', amount: '1000.00', free: false, serials: [] }],
      gstTable: [],
      totals: { gross: '1000.00', discount: '0.00', taxable: '0.00', rounding: '0.00', total: '1000.00' },
      payments: [{ method: 'Cash', amount: '1000.00', reference: null }],
      change: '0.00',
      giftCards: [{ action: 'sold', number: '6123 4567 8901 2345', barcode: true, amount: '1000.00', balance: '1000.00', expiresOn: '2027-10-21' }],
    };
  }

  it('a gift card sale prints its title, the full number with a CODE128 barcode, and no GST table', () => {
    const r = giftCardSale();
    expect(checkReceipt(r)).toEqual({ ok: true, receipt: r });
    const buf = buildReceipt(r, 80);
    const text = asText(buf);
    expect(text).toContain('GIFT CARD RECEIPT');
    expect(text).not.toContain('TAX INVOICE');
    expect(text.some((l) => /^GST\s/.test(l))).toBe(false);
    expect(text).toContain(row('Gift card sold', 'Rs. 1000.00', 48));
    expect(text).toContain('Card: 6123 4567 8901 2345');
    expect(text).toContain(row('Balance on card', 'Rs. 1000.00', 48));
    expect(text).toContain('Valid until 20-10-2027');
    expect(buf.includes(Buffer.from([...CENTRE, ...BARCODE_16, ...LEFT]))).toBe(true);
  });

  it('a bill paid by gift card prints the last 4 digits and the balance left, without a barcode', () => {
    const r: Receipt = { ...sampleSale(), giftCards: [{ action: 'spent', number: '**** 2345', barcode: false, amount: '600.00', balance: '900.00', expiresOn: '2027-10-21' }] };
    expect(checkReceipt(r).ok).toBe(true);
    const buf = buildReceipt(r, 58);
    const text = asText(buf);
    expect(text).toContain(row('Paid by gift card', 'Rs. 600.00', 32));
    expect(text).toContain('Card: **** 2345');
    expect(text).toContain(row('Balance on card', 'Rs. 900.00', 32));
    expect(buf.includes(Buffer.from([0x1d, 0x6b]))).toBe(false);
  });

  it('the points block prints only the lines that are not zero, the balance and the offline note', () => {
    const r: Receipt = { ...sampleSale(), loyalty: { scheme: 'Bazaar points', earned: 4, spent: 100, restored: 0, reversed: 0, balance: 54, note: null } };
    const text = asText(buildReceipt(r, 80));
    expect(text).toContain('Bazaar points');
    expect(text).toContain(row('Points earned', '4', 48));
    expect(text).toContain(row('Points spent', '100', 48));
    expect(text.some((l) => l.startsWith('Points given back') || l.startsWith('Points taken back'))).toBe(false);
    expect(text).toContain(row('Points balance', '54', 48));

    const offline: Receipt = { ...sampleSale(), loyalty: { scheme: 'Bazaar points', earned: 0, spent: 0, restored: 0, reversed: 0, balance: null, note: 'Points for this bill are added when the till is back online.' } };
    const t2 = asText(buildReceipt(offline, 80));
    expect(t2.some((l) => l.startsWith('Points balance'))).toBe(false);
    expect(t2.join(' ')).toContain('Points for this bill are added when the till is back online.');
  });

  it('refuses gift card and points details of the wrong shape', () => {
    const bad = (patch: Record<string, unknown>) => checkReceipt({ ...sampleSale(), ...patch });
    expect(bad({ title: 5 })).toEqual({ ok: false, error: 'receipt.title must be text' });
    expect(bad({ loyalty: { scheme: 'P', earned: 1.5, spent: 0, restored: 0, reversed: 0, balance: 0 } })).toEqual({ ok: false, error: 'receipt.loyalty.earned must be a whole number of points' });
    expect(bad({ loyalty: { earned: 1 } })).toEqual({ ok: false, error: 'receipt.loyalty.scheme is required' });
    expect(bad({ loyalty: { scheme: 'P', earned: 1, spent: 0, restored: 0, reversed: 0, balance: '5' } })).toEqual({ ok: false, error: 'receipt.loyalty.balance must be a whole number or empty' });
    const card = giftCardSale().giftCards![0];
    expect(bad({ giftCards: [{ ...card, action: 'stolen' }] })).toEqual({ ok: false, error: 'receipt.giftCards[0].action must be sold, loaded, spent or refunded' });
    expect(bad({ giftCards: [{ ...card, number: '**** 2345' }] })).toEqual({ ok: false, error: 'receipt.giftCards[0].number must be digits for a barcode' });
    expect(bad({ giftCards: [{ ...card, expiresOn: '21-10-2027' }] })).toEqual({ ok: false, error: 'receipt.giftCards[0].expiresOn must be a date (YYYY-MM-DD)' });
    expect(bad({ giftCards: [{ ...card, amount: null }] })).toEqual({ ok: false, error: 'receipt.giftCards[0] amount and balance must be numbers' });
    expect(bad({ giftCards: 'card' })).toEqual({ ok: false, error: 'receipt.giftCards must be a list of at most 10' });
  });
});
