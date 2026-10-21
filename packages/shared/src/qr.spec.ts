// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { encodeQr, qrAlignmentPositions, qrBlockLayout, qrDataCodewords, qrFormatBits, type QrEcLevel, qrSvgPath, qrVersionBits, rsGenerator, rsRemainder } from './qr.js';

// ---- An independent reader, written from the standard, to check what the encoder draws ----

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function maskBit(mask: number, row: number, col: number): boolean {
  const [i, j] = [row, col];
  return [
    (i + j) % 2 === 0,
    i % 2 === 0,
    j % 3 === 0,
    (i + j) % 3 === 0,
    (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    ((i * j) % 2) + ((i * j) % 3) === 0,
    (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
  ][mask];
}

function read(modules: boolean[][]): string {
  const n = modules.length;
  const version = (n - 17) / 4;
  const at = (x: number, y: number) => (modules[y][x] ? 1 : 0);
  // Finder patterns in three corners.
  for (const [ox, oy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        expect(at(ox + x, oy + y)).toBe(ring === 2 ? 0 : 1);
      }
  }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
    expect(at(6, i)).toBe(i % 2 === 0 ? 1 : 0);
  }
  // Both copies of the format information agree.
  const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const second = [...Array.from({ length: 8 }, (_, i) => [n - 1 - i, 8]), ...Array.from({ length: 7 }, (_, i) => [8, n - 7 + i])];
  const bits = (cells: number[][]) => cells.reduce((v, [x, y], i) => v | (at(x, y) << i), 0);
  const format = bits(first);
  expect(bits(second)).toBe(format);
  expect(at(8, n - 8)).toBe(1);
  let level: QrEcLevel | null = null;
  let mask = -1;
  for (const l of ['L', 'M', 'Q', 'H'] as const) for (let m = 0; m < 8; m++) if (qrFormatBits(l, m) === format) [level, mask] = [l, m];
  expect(level).not.toBeNull();

  // Which modules carry data.
  const fixed = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) fixed[y][x] = true;
  };
  mark(0, 0, 9, 9);
  mark(n - 8, 0, 8, 9);
  mark(0, n - 8, 9, 8);
  mark(6, 0, 1, n);
  mark(0, 6, n, 1);
  const align = qrAlignmentPositions(version);
  // Every alignment pattern except the three that would sit on the finder patterns.
  for (const cx of align) for (const cy of align) if (!((cx < 9 && cy < 9) || (cx > n - 9 && cy < 9) || (cx < 9 && cy > n - 9))) mark(cx - 2, cy - 2, 5, 5);
  if (version >= 7) {
    mark(n - 11, 0, 3, 6);
    mark(0, n - 11, 6, 3);
  }

  // Read the codewords in the zig-zag order, upwards first, skipping the timing column.
  const stream: number[] = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const row = up ? n - 1 - k : k;
      for (const x of [col, col - 1]) if (!fixed[row][x]) stream.push(at(x, row) ^ (maskBit(mask, row, x) ? 1 : 0));
    }
    up = !up;
  }
  const { blocks, ecPerBlock, totalCodewords } = qrBlockLayout(version, level!);
  const bytes = Array.from({ length: totalCodewords }, (_, i) => stream.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  const shortData = Math.floor(totalCodewords / blocks) - ecPerBlock;
  const longBlocks = totalCodewords % blocks;
  const lens = Array.from({ length: blocks }, (_, b) => shortData + (b >= blocks - longBlocks ? 1 : 0));
  const parts: number[][] = lens.map(() => []);
  let p = 0;
  for (let i = 0; i <= shortData; i++) for (let b = 0; b < blocks; b++) if (i < lens[b]) parts[b].push(bytes[p++]);
  const ecs: number[][] = lens.map(() => []);
  for (let i = 0; i < ecPerBlock; i++) for (let b = 0; b < blocks; b++) ecs[b].push(bytes[p++]);
  // Every block's Reed–Solomon syndromes are zero.
  parts.forEach((d, b) => {
    const word = [...d, ...ecs[b]];
    for (let i = 0; i < ecPerBlock; i++) {
      const s = word.reduce((acc, c) => mul(acc, EXP[i]) ^ c, 0);
      expect(s).toBe(0);
    }
  });
  const data = parts.flat();
  const dataBits = data.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  const take = (start: number, len: number) => dataBits.slice(start, start + len).reduce((a, b) => (a << 1) | b, 0);
  expect(take(0, 4)).toBe(0b0100);
  const countBits = version <= 9 ? 8 : 16;
  const count = take(4, countBits);
  const out = Array.from({ length: count }, (_, i) => take(4 + countBits + i * 8, 8));
  return new TextDecoder().decode(new Uint8Array(out));
}

describe('QR code drawing (signed QR of the e-invoice)', () => {
  it('uses the standard Reed–Solomon codes (worked example: HELLO WORLD, version 1-M)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsGenerator(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('writes the standard format and version information', () => {
    expect(qrFormatBits('M', 0).toString(2).padStart(15, '0')).toBe('101010000010010');
    expect(qrFormatBits('L', 0).toString(2).padStart(15, '0')).toBe('111011111000100');
    expect(qrFormatBits('H', 7).toString(2).padStart(15, '0')).toBe('000100000111011');
    expect(qrVersionBits(7)).toBe(0x07c94);
    expect(qrVersionBits(40)).toBe(0x28c69);
  });

  it('places alignment patterns as the standard table lists', () => {
    expect(qrAlignmentPositions(1)).toEqual([]);
    expect(qrAlignmentPositions(2)).toEqual([6, 18]);
    expect(qrAlignmentPositions(7)).toEqual([6, 22, 38]);
    expect(qrAlignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(qrAlignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(qrAlignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('has the standard byte capacities', () => {
    expect(qrDataCodewords(1, 'M')).toBe(16);
    expect(qrDataCodewords(40, 'L')).toBe(2956);
    expect(qrDataCodewords(40, 'H')).toBe(1276);
    expect(encodeQr('a'.repeat(213)).version).toBe(10); // 213 bytes is the 10-M byte capacity
    expect(encodeQr('a'.repeat(214)).version).toBe(11);
    expect(encodeQr('a'.repeat(14)).version).toBe(1);
  });

  it('reads back what it draws, for short and signed-QR-sized texts', () => {
    const header = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjQ0NDQwNUM3ODFFNDgyNTA3MkIzNENBNEY4QkRDNjA2Qzg2QjU3MjAiLCJ0eXAiOiJKV1QifQ';
    const long = `${header}.${'eyJkYXRhIjoie1wiU2VsbGVyR3N0aW5cIjpcIjI5QUFBQ0EwMDAwQTFaNVwifSJ9'.repeat(14)}.signature_${'x'.repeat(300)}`;
    for (const t of ['A', 'Hello, शुभ', 'https://example.test/irn', 'x'.repeat(100), long]) {
      const code = encodeQr(t);
      expect(code.size).toBe(code.version * 4 + 17);
      expect(read(code.modules)).toBe(t);
    }
    const big = encodeQr(long);
    expect(big.version).toBeGreaterThanOrEqual(20);
    expect(big.level).toBe('M');
  });

  it('falls back to level L when M cannot hold the text, and refuses beyond version 40', () => {
    const t = 'z'.repeat(2400);
    const code = encodeQr(t);
    expect(code.level).toBe('L');
    expect(read(code.modules)).toBe(t);
    expect(() => encodeQr('z'.repeat(3000))).toThrow(/too long/);
  });

  it('draws the dark modules as an SVG path', () => {
    const path = qrSvgPath({
      modules: [
        [true, true, false],
        [false, true, false],
      ],
    });
    expect(path).toBe('M0 0h2v1h-2zM1 1h1v1h-1z');
  });
});
