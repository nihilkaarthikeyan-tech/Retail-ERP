// Copyright (c) 2026, Rademics. All rights reserved.
// Our own small encoder for the common ESC/POS printer commands used by
// 58 mm and 80 mm thermal receipt printers. It only builds bytes; sending
// them to a printer is the job of the transports.
import { toPrintable } from './text.js';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = 'left' | 'centre' | 'right';

/** The raw command bytes, kept in one place so tests can check them. */
export const Commands = {
  /** ESC @ — reset the printer to its power-on settings. */
  init: [ESC, 0x40],
  /** ESC t 0 — character table PC437 (plain ASCII is the same in every table). */
  codePage: [ESC, 0x74, 0x00],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  alignLeft: [ESC, 0x61, 0x00],
  alignCentre: [ESC, 0x61, 0x01],
  alignRight: [ESC, 0x61, 0x02],
  /** GS ! 0x01 — double height, normal width (the line still holds the same number of characters). */
  doubleHeight: [GS, 0x21, 0x01],
  normalSize: [GS, 0x21, 0x00],
  /** GS V 66 n — feed n dots then partial cut. */
  cut: [GS, 0x56, 0x42, 0x00],
} as const;

/**
 * ESC p m t1 t2 — pulse the cash drawer connector.
 * m = 0 for pin 2 (the usual drawer), 1 for pin 5; t1/t2 = on/off time in 2 ms steps.
 */
export function drawerKickBytes(pin: 2 | 5 = 2, onMs = 50, offMs = 500): number[] {
  const t1 = Math.min(255, Math.max(1, Math.round(onMs / 2)));
  const t2 = Math.min(255, Math.max(1, Math.round(offMs / 2)));
  return [ESC, 0x70, pin === 5 ? 0x01 : 0x00, t1, t2];
}

/** Builds a list of ESC/POS bytes with chainable calls. */
export class EscPos {
  private readonly bytes: number[] = [];

  /** Reset the printer and choose the plain character table. */
  init(): this {
    return this.raw(Commands.init).raw(Commands.codePage);
  }

  raw(bytes: readonly number[]): this {
    for (const b of bytes) this.bytes.push(b & 0xff);
    return this;
  }

  /** Text without a line ending. ₹ and other symbols are turned into printable ASCII. */
  text(value: string): this {
    const s = toPrintable(value);
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i));
    return this;
  }

  /** Text followed by a line feed. */
  line(value = ''): this {
    return this.text(value).raw([LF]);
  }

  bold(on: boolean): this {
    return this.raw(on ? Commands.boldOn : Commands.boldOff);
  }

  align(a: Align): this {
    return this.raw(a === 'centre' ? Commands.alignCentre : a === 'right' ? Commands.alignRight : Commands.alignLeft);
  }

  doubleHeight(on: boolean): this {
    return this.raw(on ? Commands.doubleHeight : Commands.normalSize);
  }

  /** ESC d n — print and feed n lines. */
  feed(lines: number): this {
    return this.raw([ESC, 0x64, Math.min(255, Math.max(0, lines))]);
  }

  cut(): this {
    return this.raw(Commands.cut);
  }

  drawerKick(pin: 2 | 5 = 2): this {
    return this.raw(drawerKickBytes(pin));
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}
