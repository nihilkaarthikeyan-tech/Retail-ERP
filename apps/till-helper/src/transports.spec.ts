// Copyright (c) 2026, Rademics. All rights reserved.
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { networkTransport, PrinterError, windowsShareTransport } from './transports.js';

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
