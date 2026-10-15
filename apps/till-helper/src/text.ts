// Copyright (c) 2026, Rademics. All rights reserved.
// Plain-text helpers for fixed-width receipt paper: making text printable on
// a basic thermal printer, wrapping, and placing columns.

/** Characters most thermal printers cannot print, with what we print instead. */
const REPLACEMENTS: Record<string, string> = {
  '₹': 'Rs.', // ₹
  '–': '-', // en dash
  '—': '-', // em dash
  '−': '-', // minus sign
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '×': 'x', // ×
  ' ': ' ', // no-break space
  '•': '*', // bullet
};

/**
 * Turns any text into plain printable ASCII: ₹ becomes "Rs.", dashes and
 * quotes become their plain forms, accents are dropped, line breaks and tabs
 * become spaces, and anything else that cannot be printed becomes "?".
 */
export function toPrintable(text: string): string {
  let out = '';
  for (const ch of String(text ?? '')) {
    const rep = REPLACEMENTS[ch];
    if (rep !== undefined) {
      out += rep;
      continue;
    }
    if (ch === '\t' || ch === '\r' || ch === '\n') {
      out += ' ';
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    // Letters with accents (é → e): drop the accent marks.
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += /^[\x20-\x7e]+$/.test(base) ? base : code < 0x20 || code === 0x7f ? '' : '?';
  }
  return out;
}

/**
 * Wraps text into lines no longer than `width`, breaking at spaces where
 * possible and splitting words that are longer than a whole line.
 */
export function wrap(text: string, width: number): string[] {
  const words = toPrintable(text).split(' ').filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (let word of words) {
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A row with text on the left and a value on the right edge, e.g.
 * "Cash ........ Rs. 500.00". If the left text is too long it wraps and the
 * value goes on its last line, or on a line of its own when there is no room.
 */
export function leftRight(left: string, right: string, width: number): string[] {
  const r = toPrintable(right);
  const indent = /^ */.exec(left)![0].slice(0, Math.floor(width / 4));
  const wrapLeft = (text: string) => wrap(text, width - indent.length).map((l) => indent + l);
  if (r.length >= width) return [...wrapLeft(left), ...wrap(r, width)];
  const lines = wrapLeft(left);
  const last = lines.pop() ?? '';
  if (last.length + 1 + r.length <= width) {
    lines.push(last + ' '.repeat(width - last.length - r.length) + r);
  } else {
    if (last) lines.push(last);
    lines.push(r.padStart(width));
  }
  return lines;
}

/** Right-aligns `text` in a cell of `size` characters, or returns null if it does not fit. */
export function cellRight(text: string, size: number): string | null {
  const t = toPrintable(text);
  return t.length <= size ? t.padStart(size) : null;
}

/** Left-aligns `text` in a cell of `size` characters, or returns null if it does not fit. */
export function cellLeft(text: string, size: number): string | null {
  const t = toPrintable(text);
  return t.length <= size ? t.padEnd(size) : null;
}
