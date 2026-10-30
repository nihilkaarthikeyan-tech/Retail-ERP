// Copyright (c) 2026, Rademics. All rights reserved.
// QR code drawing for the e-invoice's signed QR code (plan 08 §4). Our own
// encoder, written from the public QR code standard (ISO/IEC 18004): byte mode,
// versions 1 to 40, Reed–Solomon error correction over GF(256), the eight
// mask patterns with the standard penalty rules. It only draws; it never reads.

export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/** Error-correction codewords per block, by level and version (index 0 unused). From the standard's capacity table. */
const EC_PER_BLOCK: Record<QrEcLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Number of error-correction blocks, by level and version (index 0 unused). */
const BLOCKS: Record<QrEcLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** The two format-information bits of each level. */
const EC_FORMAT_BITS: Record<QrEcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

export const qrSize = (version: number) => version * 4 + 17;

/** Data and error-correction modules of a version (everything but the fixed patterns). */
export function qrRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) a version and level can carry, before mode and length overhead. */
export function qrDataCodewords(version: number, level: QrEcLevel): number {
  return Math.floor(qrRawDataModules(version) / 8) - EC_PER_BLOCK[level][version] * BLOCKS[level][version];
}

/** How the codewords are split into blocks for a version and level. */
export function qrBlockLayout(version: number, level: QrEcLevel): { blocks: number; ecPerBlock: number; totalCodewords: number } {
  return { blocks: BLOCKS[level][version], ecPerBlock: EC_PER_BLOCK[level][version], totalCodewords: Math.floor(qrRawDataModules(version) / 8) };
}

/** Centre rows and columns of the alignment patterns. */
export function qrAlignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = qrSize(version) - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- Reed–Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 ----

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Generator polynomial of the given degree (highest term left out; coefficients from x^(d-1) down). */
export function rsGenerator(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Error-correction codewords for one block of data. */
export function rsRemainder(data: number[], generator: number[]): number[] {
  const result = Array.from({ length: generator.length }, () => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    generator.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// ---- Format and version information (BCH codes) ----

export function qrFormatBits(level: QrEcLevel, mask: number): number {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function qrVersionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;

// ---- The symbol ----

export interface QrCode {
  version: number;
  level: QrEcLevel;
  mask: number;
  size: number;
  /** modules[y][x]: true = dark. */
  modules: boolean[][];
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = qrSize(version);
    this.modules = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false));
    this.fixed = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false));
  }

  set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.fixed[y][x] = true;
  }

  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const align = qrAlignmentPositions(this.version);
    const last = align.length - 1;
    align.forEach((cx, i) =>
      align.forEach((cy, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );
    this.format('M', 0); // reserves the area; drawn again once the mask is chosen
    this.versionInfo();
  }

  /** Finder pattern with its light separator, centred on (cx, cy). */
  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, d !== 2 && d !== 4);
      }
    }
  }

  format(level: QrEcLevel, mask: number) {
    const bits = qrFormatBits(level, mask);
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(bits, i));
    this.set(8, n - 8, true);
  }

  private versionInfo() {
    if (this.version < 7) return;
    const bits = qrVersionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, bit(bits, i));
      this.set(b, a, bit(bits, i));
    }
  }

  placeCodewords(codewords: number[]) {
    let i = 0;
    const n = this.size;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (this.fixed[y][x] || i >= codewords.length * 8) continue;
          this.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.fixed[y][x] && qrMaskApplies(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
}

export function qrMaskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** The standard penalty score of a finished symbol; the mask with the lowest score is used. */
export function qrPenalty(modules: boolean[][]): number {
  const n = modules.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // Finder-like 1:1:3:1:1 with four light modules on one side (outside the symbol counts as light).
    const at = (i: number) => (i >= 0 && i < n ? get(i) : false);
    for (let i = -4; i < n; i++) {
      const core = at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6);
      if (!core) continue;
      if (!at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4)) score += 40;
      if (!at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10)) score += 40;
    }
  };
  for (let y = 0; y < n; y++) line((x) => modules[y][x]);
  for (let x = 0; x < n; x++) line((y) => modules[y][x]);
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) dark++;
      if (x + 1 < n && y + 1 < n) {
        const c = modules[y][x];
        if (modules[y][x + 1] === c && modules[y + 1][x] === c && modules[y + 1][x + 1] === c) score += 3;
      }
    }
  }
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Splits data into blocks, adds error correction and interleaves, as the standard lays out. */
export function qrCodewords(data: number[], version: number, level: QrEcLevel): number[] {
  const blocks = BLOCKS[level][version];
  const ecLen = EC_PER_BLOCK[level][version];
  const raw = Math.floor(qrRawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks) - ecLen;
  const gen = rsGenerator(ecLen);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i < shortBlocks ? 0 : 1);
    const part = data.slice(k, k + len);
    k += len;
    dataBlocks.push(part);
    ecBlocks.push(rsRemainder(part, gen));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

/** Text as UTF-8 bytes. */
function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/**
 * Draws a QR code for the text in byte mode, in the smallest version that fits
 * at the preferred level (M by default; L when even version 40 at M is too small).
 */
export function encodeQr(text: string, preferred: QrEcLevel = 'M'): QrCode {
  const bytes = utf8(text);
  const levels: QrEcLevel[] = preferred === 'L' ? ['L'] : [preferred, 'L'];
  for (const level of levels) {
    for (let version = 1; version <= 40; version++) {
      const countBits = version <= 9 ? 8 : 16;
      const capacityBits = qrDataCodewords(version, level) * 8;
      if (4 + countBits + bytes.length * 8 > capacityBits) continue;
      return build(bytes, version, level, countBits, capacityBits);
    }
  }
  throw new Error('The text is too long for a QR code');
}

function build(bytes: number[], version: number, level: QrEcLevel, countBits: number, capacityBits: number): QrCode {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const codewords = qrCodewords(data, version, level);

  let best: QrCode | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(version);
    g.drawFunctionPatterns();
    g.placeCodewords(codewords);
    g.applyMask(mask);
    g.format(level, mask);
    const score = qrPenalty(g.modules);
    if (score < bestScore) {
      bestScore = score;
      best = { version, level, mask, size: g.size, modules: g.modules };
    }
  }
  return best!;
}

/** An SVG path of the dark modules (one unit per module), for drawing at any size. Add a 4-module quiet zone around it. */
export function qrSvgPath(code: Pick<QrCode, 'modules'>): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join('');
}
