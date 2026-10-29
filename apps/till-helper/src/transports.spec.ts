// Copyright (c) 2026, Rademics. All rights reserved.
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { askPrinterStatus, decodeStatus, isStatusByte, networkTransport, printerStatusCheck, PrinterError, statusQuestion, windowsShareTransport } from './transports.js';

/** A fake printer connection: answers each DLE EOT n with the byte given for n (or stays silent). */
class FakeSocket extends EventEmitter {
  readonly written: Buffer[] = [];
  constructor(private readonly answers: Partial<Record<number, number[]>>) {
    super();
  }
  write(data: Buffer) {
    this.written.push(data);
    const reply = this.answers[data[2]!];
    if (reply) setTimeout(() => this.emit('data', Buffer.from(reply)), 1);
    return true;
  }
}

// Status bytes as an ESC/POS printer sends them: bits 1 and 4 are always set.
const FIXED = 0x12;

describe('printer status (DLE EOT n, owner decision C9)', () => {
  it('asks the three questions with DLE EOT 1, 2 and 4', async () => {
    const socket = new FakeSocket({ 1: [FIXED], 2: [FIXED], 4: [FIXED] });
    expect(await askPrinterStatus(socket, 50)).toEqual({ known: true, problem: null, paperLow: false });
    expect(socket.written).toEqual([statusQuestion(1), statusQuestion(2), statusQuestion(4)]);
    expect([...statusQuestion(4)]).toEqual([0x10, 0x04, 0x04]);
  });

  it('reports no paper, cover open and offline', async () => {
    expect(await askPrinterStatus(new FakeSocket({ 1: [FIXED | 0x08], 2: [FIXED | 0x20], 4: [FIXED | 0x60] }), 50)).toMatchObject({ known: true, problem: 'no_paper' });
    expect(await askPrinterStatus(new FakeSocket({ 1: [FIXED | 0x08], 2: [FIXED | 0x04], 4: [FIXED] }), 50)).toMatchObject({ known: true, problem: 'cover_open' });
    expect(await askPrinterStatus(new FakeSocket({ 1: [FIXED | 0x08], 2: [FIXED], 4: [FIXED] }), 50)).toMatchObject({ known: true, problem: 'offline' });
    expect(await askPrinterStatus(new FakeSocket({ 1: [FIXED], 2: [FIXED | 0x40], 4: [FIXED] }), 50)).toMatchObject({ known: true, problem: 'offline' });
  });

  it('says when the paper is nearly out but still prints', () => {
    expect(decodeStatus(FIXED, FIXED, FIXED | 0x0c)).toEqual({ known: true, problem: null, paperLow: true });
  });

  it('treats no answer as not known, not as a failure', async () => {
    expect(await askPrinterStatus(new FakeSocket({}), 20)).toEqual({ known: false });
    // Answers the first question only.
    expect(await askPrinterStatus(new FakeSocket({ 1: [FIXED] }), 20)).toEqual({ known: false });
  });

  it('ignores bytes that are not status bytes', async () => {
    expect(isStatusByte(0x41)).toBe(false);
    expect(isStatusByte(FIXED | 0x08)).toBe(true);
    expect(await askPrinterStatus(new FakeSocket({ 1: [0x41] }), 20)).toEqual({ known: false });
    expect(await askPrinterStatus(new FakeSocket({ 1: [0x41, FIXED], 2: [FIXED], 4: [FIXED | 0x40] }), 50)).toMatchObject({ known: true, problem: 'no_paper' });
  });

  it('asks a network printer on its own connection and closes it', async () => {
    const socket = Object.assign(new FakeSocket({ 1: [FIXED], 2: [FIXED | 0x20], 4: [FIXED | 0x60] }), {
      destroyed: false,
      setTimeout() {},
      destroy() {
        this.destroyed = true;
      },
    });
    const connectTo = ((opts: { host: string; port: number }) => {
      expect(opts).toEqual({ host: '192.168.1.50', port: 9100 });
      setTimeout(() => socket.emit('connect'), 1);
      return socket;
    }) as unknown as Parameters<typeof networkTransport>[3];
    const status = await networkTransport('192.168.1.50', 9100, 10_000, connectTo).status!();
    expect(status).toMatchObject({ known: true, problem: 'no_paper' });
    expect(socket.destroyed).toBe(true);
  });

  it('reports a network printer that cannot be reached when asking its status', async () => {
    await expect(networkTransport('127.0.0.1', 1, 2000).status!()).rejects.toBeInstanceOf(PrinterError);
  });

  it('says in /status which printers can report paper', () => {
    expect(printerStatusCheck({ kind: 'network', host: 'x', port: 9100 }).readable).toBe(true);
    expect(printerStatusCheck({ kind: 'windows', share: 'RECEIPT' })).toEqual({ readable: false, note: expect.stringContaining('cannot report paper') });
    expect(printerStatusCheck({ kind: 'serial', port: 'COM3', baudRate: 9600 }).readable).toBe(false);
  });
});

describe('network printer (raw TCP, port 9100)', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
  });

  it('sends the bytes unchanged', async () => {
    const received: Buffer[] = [];
    const done = new Promise<void>((resolve) => {
      server = createServer((socket) => {
        socket.on('data', (d: Buffer) => received.push(d));
        socket.on('end', () => resolve());
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server!.address() as { port: number }).port;
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
    await networkTransport('127.0.0.1', port).send(bytes);
    await done;
    expect(Buffer.concat(received)).toEqual(bytes);
  });

  it('reports a printer that is not there', async () => {
    await expect(networkTransport('127.0.0.1', 1, 2000).send(Buffer.from('x'))).rejects.toBeInstanceOf(PrinterError);
  });
});

describe('Windows shared USB printer', () => {
  it('copies the bytes in binary mode to \\\\localhost\\<share>', async () => {
    const commands: string[] = [];
    const run = async (cmd: string) => {
      commands.push(cmd);
    };
    await windowsShareTransport('RECEIPT', run).send(Buffer.from('x'));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatch(/^copy \/b ".+till-helper-[0-9a-f]+\.bin" "\\\\localhost\\RECEIPT"$/);
  });

  it('reports a failed copy as a printer error', async () => {
    const run = async () => {
      throw new Error('The network name cannot be found.');
    };
    await expect(windowsShareTransport('RECEIPT', run).send(Buffer.from('x'))).rejects.toThrow(/RECEIPT.*network name/);
  });
});
