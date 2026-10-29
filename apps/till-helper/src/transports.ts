// Copyright (c) 2026, Rademics. All rights reserved.
// Sending raw printer bytes to the receipt printer. Three ways, all with
// Node's own modules (no extra libraries):
//  - network: TCP to the printer's IP address, port 9100;
//  - windows: a USB printer shared in Windows, sent through the print
//    spooler with `copy /b <file> \\localhost\<share>`;
//  - serial: a COM port, set up with the Windows `mode` command and written
//    to as the device file \\.\COMn.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, unlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrinterConfig } from './config.js';

/** What stops a printer from printing, as the till is told (owner decision C9, 29 October 2026). */
export type PrinterProblem = 'no_paper' | 'cover_open' | 'offline';

/** The printer's answer to the status questions; `known: false` when it did not answer (not a failure). */
export type PrinterStatus = { known: false } | { known: true; problem: PrinterProblem | null; paperLow: boolean };

/** Something that can deliver bytes to the printer. */
export interface Transport {
  send(bytes: Buffer): Promise<void>;
  /** Asks the printer about paper, cover and offline; only printers that can answer have it. */
  status?(): Promise<PrinterStatus>;
}

export class PrinterError extends Error {}

const TIMEOUT_MS = 10_000;
/** How long to wait for each status reply; a printer that does not answer in time counts as "not known". */
export const STATUS_REPLY_MS = 700;
/** How long the status connection may take in all, so a print still finishes well inside the till's 15 s. */
const STATUS_TIMEOUT_MS = 2_500;

// ---------------------------------------------------------------------------
// Printer status (ESC/POS real-time status, DLE EOT n). The printer answers
// each question with one byte, even while it is offline or out of paper:
//   n = 1 printer status: bit 3 = offline;
//   n = 2 offline cause:  bit 2 = cover open, bit 5 = stopped at paper end, bit 6 = error;
//   n = 4 paper sensor:   bits 2-3 = paper nearly out, bits 5-6 = paper out.
// Every status byte has bits 1 and 4 set and bits 0 and 7 clear, which tells it
// apart from anything else the printer might send.

const DLE = 0x10;
const EOT = 0x04;
export const STATUS_QUESTIONS = [1, 2, 4] as const;

export function statusQuestion(n: (typeof STATUS_QUESTIONS)[number]): Buffer {
  return Buffer.from([DLE, EOT, n]);
}

export function isStatusByte(b: number): boolean {
  return (b & 0x93) === 0x12;
}

/** Turns the three status bytes into what the till is told. */
export function decodeStatus(printer: number, cause: number, paper: number): PrinterStatus {
  const paperOut = (paper & 0x60) !== 0 || (cause & 0x20) !== 0;
  const coverOpen = (cause & 0x04) !== 0;
  const offline = (printer & 0x08) !== 0 || (cause & 0x40) !== 0;
  const problem: PrinterProblem | null = paperOut ? 'no_paper' : coverOpen ? 'cover_open' : offline ? 'offline' : null;
  return { known: true, problem, paperLow: !paperOut && (paper & 0x0c) !== 0 };
}

/** The little of a socket the status questions need (a fake one in tests). */
export interface StatusSocket {
  write(data: Buffer): unknown;
  on(event: 'data', listener: (data: Buffer) => void): unknown;
  removeListener(event: 'data', listener: (data: Buffer) => void): unknown;
}

function askOne(socket: StatusSocket, n: (typeof STATUS_QUESTIONS)[number], replyMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (b: number | null) => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      resolve(b);
    };
    const onData = (data: Buffer) => {
      const b = data.find(isStatusByte);
      if (b !== undefined) done(b);
    };
    timer = setTimeout(() => done(null), replyMs);
    socket.on('data', onData);
    socket.write(statusQuestion(n));
  });
}

/** Asks the three status questions one after the other; no answer to any of them means "not known". */
export async function askPrinterStatus(socket: StatusSocket, replyMs = STATUS_REPLY_MS): Promise<PrinterStatus> {
  const answers: number[] = [];
  for (const n of STATUS_QUESTIONS) {
    const b = await askOne(socket, n, replyMs);
    if (b === null) return { known: false };
    answers.push(b);
  }
  return decodeStatus(answers[0]!, answers[1]!, answers[2]!);
}

/** Raw TCP ("port 9100" / JetDirect) to a network printer. */
export function networkTransport(host: string, port = 9100, timeoutMs = TIMEOUT_MS, connectTo: typeof connect = connect): Transport {
  return {
    // Its own short connection before the receipt: a printer that cannot be reached is an error,
    // one that does not answer the questions is "not known" and the receipt is still sent.
    status: () =>
      new Promise<PrinterStatus>((resolve, reject) => {
        const socket = connectTo({ host, port });
        let done = false;
        const finish = (result: PrinterStatus | Error) => {
          if (done) return;
          done = true;
          socket.destroy();
          if (result instanceof Error) reject(new PrinterError(`Network printer ${host}:${port}: ${result.message}`));
          else resolve(result);
        };
        socket.setTimeout(Math.min(timeoutMs, STATUS_TIMEOUT_MS), () => finish({ known: false }));
        socket.once('error', finish);
        socket.once('connect', () => {
          askPrinterStatus(socket).then(finish, () => finish({ known: false }));
        });
      }),
    send: (bytes) =>
      new Promise<void>((resolve, reject) => {
        const socket = connectTo({ host, port });
        let done = false;
        const finish = (err?: Error) => {
          if (done) return;
          done = true;
          socket.destroy();
          if (err) reject(new PrinterError(`Network printer ${host}:${port}: ${err.message}`));
          else resolve();
        };
        socket.setTimeout(timeoutMs, () => finish(new Error('no answer (timed out)')));
        socket.once('error', finish);
        socket.once('connect', () => {
          socket.end(bytes, () => finish());
        });
      }),
  };
}

/** Runs a Windows command line and resolves when it exits with code 0. */
export type CommandRunner = (commandLine: string) => Promise<void>;

export const runCmd: CommandRunner = (commandLine) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(output.trim() || `exit code ${code}`));
    });
  });

/**
 * USB printer installed in Windows and shared as `share`. The bytes go to the
 * spooler unchanged (RAW), the same as `copy /b receipt.bin \\localhost\RECEIPT`.
 */
export function windowsShareTransport(share: string, run: CommandRunner = runCmd): Transport {
  return {
    async send(bytes) {
      const file = join(tmpdir(), `till-helper-${randomBytes(6).toString('hex')}.bin`);
      await writeFile(file, bytes);
      try {
        await run(`copy /b "${file}" "\\\\localhost\\${share}"`);
      } catch (err) {
        throw new PrinterError(`Windows printer share "${share}": ${(err as Error).message}`);
      } finally {
        await unlink(file).catch(() => undefined);
      }
    },
  };
}

/** Serial printer on a COM port (Windows). */
export function serialTransport(port: string, baudRate = 9600, run: CommandRunner = runCmd): Transport {
  return {
    async send(bytes) {
      try {
        await run(`mode ${port}: BAUD=${baudRate} PARITY=n DATA=8 STOP=1`);
        const handle = await open(`\\\\.\\${port}`, 'r+');
        try {
          await handle.write(bytes);
        } finally {
          await handle.close();
        }
      } catch (err) {
        throw new PrinterError(`Serial printer ${port}: ${(err as Error).message}`);
      }
    },
  };
}

/** The transport for the configured printer, or null when none is set up. */
export function transportFor(printer: PrinterConfig): Transport | null {
  switch (printer.kind) {
    case 'network':
      return networkTransport(printer.host, printer.port);
    case 'windows':
      return windowsShareTransport(printer.share);
    case 'serial':
      return serialTransport(printer.port, printer.baudRate);
    default:
      return null;
  }
}

/** Owner decision C9: whether the helper can ask this printer about paper and cover, said plainly for /status. */
export function printerStatusCheck(printer: PrinterConfig): { readable: boolean; note: string | null } {
  switch (printer.kind) {
    case 'network':
      return { readable: true, note: 'Paper, cover and offline are checked before each receipt.' };
    case 'windows':
      return { readable: false, note: 'A USB printer shared in Windows cannot report paper or cover; check the paper by eye.' };
    case 'serial':
      return { readable: false, note: 'The paper and cover of a serial printer are not read; check the paper by eye.' };
    default:
      return { readable: false, note: null };
  }
}

/** Short description of the printer for /status. */
export function printerName(printer: PrinterConfig): string | null {
  switch (printer.kind) {
    case 'network':
      return `${printer.host}:${printer.port ?? 9100}`;
    case 'windows':
      return `\\\\localhost\\${printer.share}`;
    case 'serial':
      return printer.port;
    default:
      return null;
  }
}
