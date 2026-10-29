// Copyright (c) 2026, Rademics. All rights reserved.
import { request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig, type HelperConfig } from './config.js';
import { drawerKickBytes } from './escpos.js';
import { Pairing } from './pairing.js';
import { buildReceipt } from './receipt.js';
import { createHelperServer, listenLocal } from './server.js';
import { sampleSale } from './test-support/sample-receipt.js';
import type { PrinterStatus, Transport } from './transports.js';

const ERP = 'http://localhost:3000';
const TOKEN = 'secret-token-0123456789-abcdefghijklmnop';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text ? JSON.parse(text) : null }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

describe('Till Helper HTTP service', () => {
  let server: Server;
  let port: number;
  let send: ReturnType<typeof vi.fn<(bytes: Buffer) => Promise<void>>>;
  let status: ReturnType<typeof vi.fn<() => Promise<PrinterStatus>>>;
  let config: HelperConfig;
  const ok = { origin: ERP, 'x-helper-token': TOKEN };

  async function start(overrides: Record<string, unknown> = {}, withPrinter = true, code = '654321') {
    config = parseConfig({
      allowedOrigins: [ERP],
      printer: { kind: 'network', host: '192.168.1.50' },
      ...overrides,
    });
    send = vi.fn<(bytes: Buffer) => Promise<void>>(async () => undefined);
    status = vi.fn<() => Promise<PrinterStatus>>(async () => ({ known: false }));
    const transport: Transport | null = withPrinter ? { send, status } : null;
    server = createHelperServer({ config, pairing: new Pairing(TOKEN, code), transport });
    port = await listenLocal(server, 0);
  }

  beforeEach(async () => {
    await start();
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('listens only on 127.0.0.1', () => {
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
  });

  describe('who may call', () => {
    it('refuses a request without the token (401)', async () => {
      const r = await call(port, 'GET', '/status', { origin: ERP });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('no_token');
    });

    it('refuses a wrong token (403)', async () => {
      const r = await call(port, 'GET', '/status', { origin: ERP, 'x-helper-token': TOKEN + 'x' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('bad_token');
    });

    it('refuses another web address even with the right token (403, no CORS header)', async () => {
      const r = await call(port, 'GET', '/status', { origin: 'https://evil.example', 'x-helper-token': TOKEN });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('bad_origin');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses a request with no web address at all (403)', async () => {
      const r = await call(port, 'GET', '/status', { 'x-helper-token': TOKEN });
      expect(r.status).toBe(403);
    });

    it('refuses a request addressed to another host name (DNS rebinding)', async () => {
      const r = await call(port, 'GET', '/status', { ...ok, host: `evil.example:${port}` });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('bad_host');
    });

    it('answers the browser pre-check (OPTIONS) for the ERP address only', async () => {
      const good = await call(port, 'OPTIONS', '/print', {
        origin: ERP,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-helper-token',
        'access-control-request-private-network': 'true',
      });
      expect(good.status).toBe(204);
      expect(good.headers['access-control-allow-origin']).toBe(ERP);
      expect(good.headers['access-control-allow-headers']).toContain('x-helper-token');
      expect(good.headers['access-control-allow-methods']).toContain('POST');
      expect(good.headers['access-control-allow-private-network']).toBe('true');

      const bad = await call(port, 'OPTIONS', '/print', { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
      expect(bad.status).toBe(403);
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('pairing', () => {
    it('gives the token for the right code once', async () => {
      const wrong = await call(port, 'POST', '/pair', { origin: ERP }, { code: '000000' });
      expect(wrong.status).toBe(403);
      const right = await call(port, 'POST', '/pair', { origin: ERP }, { code: '654321' });
      expect(right.status).toBe(200);
      expect(right.body).toEqual({ ok: true, token: TOKEN });
      expect(right.headers['access-control-allow-origin']).toBe(ERP);
      const again = await call(port, 'POST', '/pair', { origin: ERP }, { code: '654321' });
      expect(again.status).toBe(403);
    });

    it('does not pair another web address', async () => {
      const r = await call(port, 'POST', '/pair', { origin: 'https://evil.example' }, { code: '654321' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('bad_origin');
    });
  });

  describe('GET /status', () => {
    it('reports the printer and drawer', async () => {
      const r = await call(port, 'GET', '/status', ok);
      expect(r.status).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBe(ERP);
      expect(r.body).toEqual({
        ok: true,
        version: '0.1.0',
        paperWidth: 80,
        printer: { configured: true, kind: 'network', name: '192.168.1.50:9100', statusReadable: true, statusNote: expect.stringContaining('checked before each receipt') },
        drawer: { configured: true },
      });
    });

    it('says when no printer is set up', async () => {
      server.close();
      await start({ printer: { kind: 'none' } }, false);
      const r = await call(port, 'GET', '/status', ok);
      expect(r.body.printer).toEqual({ configured: false, kind: null, name: null, statusReadable: false, statusNote: null });
      expect(r.body.drawer).toEqual({ configured: false });
    });
  });

  describe('POST /print', () => {
    it('sends the receipt bytes to the printer', async () => {
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toEqual(buildReceipt(sampleSale(), 80));
    });

    it('uses 58 mm layout when configured', async () => {
      server.close();
      await start({ paperWidth: 58 });
      await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(send.mock.calls[0]![0]).toEqual(buildReceipt(sampleSale(), 58));
    });

    it('refuses a receipt with a bad shape without printing', async () => {
      const r = await call(port, 'POST', '/print', ok, { receipt: { number: 'X' } });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('bad_receipt');
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses printing without the token', async () => {
      const r = await call(port, 'POST', '/print', { origin: ERP }, { receipt: sampleSale() });
      expect(r.status).toBe(401);
      expect(send).not.toHaveBeenCalled();
    });

    it('answers 503 when the printer fails, so the till prints through the browser', async () => {
      send.mockRejectedValueOnce(new Error('connection refused'));
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('printer_error');
      expect(r.headers['access-control-allow-origin']).toBe(ERP);
    });

    it('answers 503 when no printer is set up', async () => {
      server.close();
      await start({ printer: { kind: 'none' } }, false);
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('printer_not_configured');
    });

    it('prints two receipts one after the other, never mixed', async () => {
      const order: string[] = [];
      send.mockImplementation(async (bytes: Buffer) => {
        const n = bytes.includes(Buffer.from('S1-T1-000123')) ? 'A' : 'B';
        order.push(`start ${n}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end ${n}`);
      });
      const b = { ...sampleSale(), number: 'S1-T1-000124' };
      await Promise.all([call(port, 'POST', '/print', ok, { receipt: sampleSale() }), call(port, 'POST', '/print', ok, { receipt: b })]);
      expect(order).toHaveLength(4);
      expect(order[1]!.startsWith('end')).toBe(true);
    });

    it('asks the printer for paper and cover first, and prints when it does not answer', async () => {
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(200);
      expect(status).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no_paper', /out of paper/],
      ['cover_open', /cover is open/],
      ['offline', /offline/],
    ] as const)('does not print and says why when the printer reports %s', async (problem, message) => {
      status.mockResolvedValueOnce({ known: true, problem, paperLow: false });
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe(problem);
      expect(r.body.error).toMatch(message);
      expect(send).not.toHaveBeenCalled();
    });

    it('prints when the paper is only nearly out', async () => {
      status.mockResolvedValueOnce({ known: true, problem: null, paperLow: true });
      expect((await call(port, 'POST', '/print', ok, { receipt: sampleSale() })).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('answers printer_error when the printer cannot be reached for its status', async () => {
      status.mockRejectedValueOnce(new Error('connection refused'));
      const r = await call(port, 'POST', '/print', ok, { receipt: sampleSale() });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('printer_error');
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses a body that is not JSON', async () => {
      const r = await call(port, 'POST', '/print', { ...ok, 'content-type': 'text/plain' }, { receipt: sampleSale() });
      expect(r.status).toBe(415);
    });
  });

  describe('POST /drawer/open', () => {
    it('sends the drawer kick through the printer', async () => {
      const r = await call(port, 'POST', '/drawer/open', ok);
      expect(r.status).toBe(200);
      expect([...send.mock.calls[0]![0]]).toEqual(drawerKickBytes(2));
      // The drawer opens through the printer without the paper check.
      expect(status).not.toHaveBeenCalled();
    });

    it('refuses when no drawer is set up', async () => {
      server.close();
      await start({ drawer: { enabled: false } });
      const r = await call(port, 'POST', '/drawer/open', ok);
      expect(r.status).toBe(409);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses without the token', async () => {
      const r = await call(port, 'POST', '/drawer/open', { origin: ERP, 'x-helper-token': 'nope' });
      expect(r.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('answers 404 for unknown paths and 405 for wrong methods', async () => {
    expect((await call(port, 'GET', '/nothing', ok)).status).toBe(404);
    expect((await call(port, 'GET', '/print', ok)).status).toBe(405);
  });
});
