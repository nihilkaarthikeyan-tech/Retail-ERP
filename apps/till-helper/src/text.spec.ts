// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { leftRight, toPrintable, wrap } from './text.js';

describe('toPrintable', () => {
  it('prints the rupee sign as "Rs." and plain forms of dashes, quotes and accents', () => {
    expect(toPrintable('₹ 372.00')).toBe('Rs. 372.00');
    expect(toPrintable('Tea – “Assam” — 1×')).toBe('Tea - "Assam" - 1x');
    expect(toPrintable('Café')).toBe('Cafe');
  });
  it('turns line breaks into spaces and unknown characters into "?"', () => {
    expect(toPrintable('a\nb\tc')).toBe('a b c');
    expect(toPrintable('நன்றி')).toMatch(/^\?+$/);
    expect(toPrintable('x\u0007y')).toBe('xy');
  });
});

describe('wrap', () => {
  const text = 'Thank you for shopping with us. Goods once sold can be exchanged within 7 days with the bill.';

  it.each([48, 32])('keeps every line within %i characters, breaking at spaces', (width) => {
    const lines = wrap(text, width);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(width);
    expect(lines.join(' ')).toBe(text);
  });

  it('wraps at 48 columns', () => {
    expect(wrap(text, 48)).toEqual([
      'Thank you for shopping with us. Goods once sold',
      'can be exchanged within 7 days with the bill.',
    ]);
  });

  it('wraps at 32 columns', () => {
    expect(wrap(text, 32)).toEqual([
      'Thank you for shopping with us.',
      'Goods once sold can be exchanged',
      'within 7 days with the bill.',
    ]);
  });

  it('splits a word longer than the line', () => {
    expect(wrap('ABCDEFGHIJ KL', 4)).toEqual(['ABCD', 'EFGH', 'IJ', 'KL']);
  });
});

describe('leftRight', () => {
  it('puts the value on the right edge', () => {
    expect(leftRight('Cash', 'Rs. 500.00', 32)).toEqual(['Cash                  Rs. 500.00']);
  });
  it('keeps the indent and wraps long text, with the value on the last line', () => {
    const lines = leftRight('  Refund by Bank transfer to customer account', '122.00', 32);
    expect(lines).toEqual(['  Refund by Bank transfer to', '  customer account        122.00']);
  });
  it('moves the value to its own line when there is no room', () => {
    expect(leftRight('ABCDEFGHIJ', '12345', 12)).toEqual(['ABCDEFGHIJ', '       12345']);
  });
});
