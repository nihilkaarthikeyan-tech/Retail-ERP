// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { drawerKickBytes, EscPos } from './escpos.js';

describe('ESC/POS encoder', () => {
  it('encodes the basic commands', () => {
    const bytes = new EscPos()
      .init()
      .bold(true)
      .align('centre')
      .doubleHeight(true)
      .line('₹5')
      .doubleHeight(false)
      .align('right')
      .bold(false)
      .feed(3)
      .cut()
      .toBuffer();
    expect([...bytes]).toEqual([
      0x1b, 0x40, // ESC @ init
      0x1b, 0x74, 0x00, // ESC t 0 code page
      0x1b, 0x45, 0x01, // ESC E 1 bold on
      0x1b, 0x61, 0x01, // ESC a 1 centre
      0x1d, 0x21, 0x01, // GS ! 1 double height
      0x52, 0x73, 0x2e, 0x35, 0x0a, // "Rs.5\n"
      0x1d, 0x21, 0x00, // GS ! 0 normal size
      0x1b, 0x61, 0x02, // ESC a 2 right
      0x1b, 0x45, 0x00, // ESC E 0 bold off
      0x1b, 0x64, 0x03, // ESC d 3 feed
      0x1d, 0x56, 0x42, 0x00, // GS V 66 0 partial cut
    ]);
  });

  it('kicks the cash drawer on pin 2 with a 50 ms pulse', () => {
    expect(drawerKickBytes()).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect([...new EscPos().drawerKick().toBuffer()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it('kicks the cash drawer on pin 5 when asked', () => {
    expect(drawerKickBytes(5)).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });

  it('prints a CODE128 barcode of an even number of digits in code set C, text below', () => {
    expect([...new EscPos().barcode128('612345').toBuffer()]).toEqual([
      0x1d, 0x68, 80, // GS h 80 height
      0x1d, 0x77, 2, // GS w 2 bar width
      0x1d, 0x48, 2, // GS H 2 text below
      0x1d, 0x66, 0, // GS f 0 font A
      0x1d, 0x6b, 73, 5, 0x7b, 0x43, 61, 23, 45, // GS k 73 n {C 61 23 45
      0x0a,
    ]);
  });

  it('uses code set B for other text, and refuses what a barcode cannot hold', () => {
    expect([...new EscPos().barcode128('A1').toBuffer()].slice(12)).toEqual([0x1d, 0x6b, 73, 4, 0x7b, 0x42, 0x41, 0x31, 0x0a]);
    expect([...new EscPos().barcode128('123').toBuffer()].slice(15, 20)).toEqual([5, 0x7b, 0x42, 0x31, 0x32]);
    expect(() => new EscPos().barcode128('')).toThrow(/1 to 80/);
    expect(() => new EscPos().barcode128('₹5')).toThrow(/plain characters/);
  });
});
