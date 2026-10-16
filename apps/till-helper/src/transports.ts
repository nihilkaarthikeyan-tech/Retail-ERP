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

/** Something that can deliver bytes to the printer. */
export interface Transport {
  send(bytes: Buffer): Promise<void>;
}

export class PrinterError extends Error {}

const TIMEOUT_MS = 10_000;

/** Raw TCP ("port 9100" / JetDirect) to a network printer. */
export function networkTransport(host: string, port = 9100, timeoutMs = TIMEOUT_MS): Transport {
  return {
    send: (bytes) =>
      new Promise<void>((resolve, reject) => {
        const socket = connect({ host, port });
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
