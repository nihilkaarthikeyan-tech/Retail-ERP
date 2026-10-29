// Copyright (c) 2026, Rademics. All rights reserved.
// The helper's small HTTP service on 127.0.0.1 for the till page
// (pos-offline plan §9). Only our ERP's web address may call it, and every
// request except pairing must carry the pairing token.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { HelperConfig } from './config.js';
import { EscPos } from './escpos.js';
import type { Pairing } from './pairing.js';
import { buildReceipt, checkReceipt } from './receipt.js';
import { printerName, type PrinterProblem, type PrinterStatus, printerStatusCheck, type Transport } from './transports.js';
import { VERSION } from './version.js';

export const TOKEN_HEADER = 'x-helper-token';
/** What the till shows the cashier when the printer reports a problem (owner decision C9). */
export const PROBLEM_MESSAGE: Record<PrinterProblem, string> = {
  no_paper: 'The receipt printer is out of paper. Put in a new roll.',
  cover_open: 'The receipt printer cover is open. Close it.',
  offline: 'The receipt printer is offline. Check it is switched on and shows no error light.',
};
const MAX_BODY_BYTES = 1024 * 1024;
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface ServerDeps {
  config: HelperConfig;
  pairing: Pairing;
  /** The printer connection, or null when no printer is configured. */
  transport: Transport | null;
  log?: (message: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    let size = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    req.on('data', (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, 'Request is too large', 'too_large'));
        return;
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (failed) return;
      if (size === 0) return resolve({});
      if (type !== 'application/json') return reject(new HttpError(415, 'Send JSON (Content-Type: application/json)', 'bad_type'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON', 'bad_json'));
      }
    });
  });
}

export function createHelperServer(deps: ServerDeps): Server {
  const { config, pairing, transport } = deps;
  const log = deps.log ?? (() => undefined);
  const allowed = new Set(config.allowedOrigins);

  // One print job at a time, so two receipts never mix on the paper.
  let queue: Promise<unknown> = Promise.resolve();
  const sendToPrinter = (bytes: Buffer, checkFirst = false): Promise<void> => {
    const job = queue.then(async () => {
      if (!transport) throw new HttpError(503, 'No receipt printer is set up in the Till Helper', 'printer_not_configured');
      // Owner decision C9: a printer that can answer is asked about paper and cover first.
      if (checkFirst && transport.status) {
        let status: PrinterStatus;
        try {
          status = await transport.status();
        } catch (err) {
          throw new HttpError(503, `Printer did not respond: ${(err as Error).message}`, 'printer_error');
        }
        if (status.known && status.problem) throw new HttpError(503, PROBLEM_MESSAGE[status.problem], status.problem);
        if (status.known && status.paperLow) log('Receipt paper is nearly out');
      }
      try {
        await transport.send(bytes);
      } catch (err) {
        throw new HttpError(503, `Printer did not respond: ${(err as Error).message}`, 'printer_error');
      }
    });
    queue = job.catch(() => undefined);
    return job;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    const send = (status: number, body: unknown, cors: boolean) => {
      const headers: Record<string, string> = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        vary: 'Origin',
      };
      if (cors) headers['access-control-allow-origin'] = origin;
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    const refuse = (status: number, error: string, code: string, cors: boolean) => send(status, { ok: false, error, code }, cors);

    // Requests must be addressed to this computer itself (blocks DNS-rebinding tricks).
    const host = String(req.headers.host ?? '');
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
    if (!LOCAL_HOSTNAMES.has(hostname.toLowerCase())) return refuse(403, 'Wrong address', 'bad_host', false);

    // Only our ERP's web address.
    if (!origin || !allowed.has(origin)) return refuse(403, 'This web address may not use the Till Helper', 'bad_origin', false);

    if (req.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': `content-type, ${TOKEN_HEADER}`,
        'access-control-max-age': '600',
        vary: 'Origin',
      };
      // Chrome's "private network access" check for pages calling 127.0.0.1.
      if (req.headers['access-control-request-private-network'] === 'true') {
        headers['access-control-allow-private-network'] = 'true';
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const path = (req.url ?? '/').split('?')[0]!;
    const route = `${req.method} ${path}`;

    if (route === 'POST /pair') {
      const body = (await readBody(req)) as { code?: unknown };
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const result = pairing.redeem(code);
      if (result.ok) {
        log(`Paired with ${origin}`);
        return send(200, { ok: true, token: result.token }, true);
      }
      log(`Pairing refused (${result.reason}) from ${origin}`);
      const message =
        result.reason === 'wrong'
          ? 'Wrong pairing code'
          : 'The pairing code has expired. Restart the Till Helper to get a new code.';
      return refuse(403, message, `pair_${result.reason}`, true);
    }

    const token = req.headers[TOKEN_HEADER];
    if (typeof token !== 'string' || token === '') return refuse(401, 'Pair the till with the Till Helper first', 'no_token', true);
    if (!pairing.checkToken(token)) return refuse(403, 'Wrong Till Helper token. Pair the till again.', 'bad_token', true);

    switch (route) {
      case 'GET /status':
        return send(
          200,
          {
            ok: true,
            version: VERSION,
            paperWidth: config.paperWidth,
            printer: {
              configured: transport !== null,
              kind: config.printer.kind === 'none' ? null : config.printer.kind,
              name: printerName(config.printer),
              // Owner decision C9: whether paper and cover can be read from this printer.
              statusReadable: printerStatusCheck(config.printer).readable,
              statusNote: printerStatusCheck(config.printer).note,
            },
            drawer: { configured: transport !== null && config.drawer.enabled },
          },
          true,
        );

      case 'POST /print': {
        const body = (await readBody(req)) as { receipt?: unknown };
        const checked = checkReceipt(body?.receipt);
        if (!checked.ok) return refuse(400, checked.error, 'bad_receipt', true);
        const bytes = buildReceipt(checked.receipt, config.paperWidth);
        await sendToPrinter(bytes, true);
        log(`Printed ${checked.receipt.kind} ${checked.receipt.number}${checked.receipt.duplicate ? ' (duplicate)' : ''}`);
        return send(200, { ok: true }, true);
      }

      case 'POST /drawer/open': {
        await readBody(req);
        if (!config.drawer.enabled) return refuse(409, 'No cash drawer is set up in the Till Helper', 'drawer_not_configured', true);
        await sendToPrinter(new EscPos().drawerKick(config.drawer.pin).toBuffer());
        log('Opened cash drawer');
        return send(200, { ok: true }, true);
      }

      default:
        if (['/status', '/print', '/drawer/open', '/pair'].includes(path)) {
          return refuse(405, 'Method not allowed', 'bad_method', true);
        }
        return refuse(404, 'Not found', 'not_found', true);
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const e = err instanceof HttpError ? err : new HttpError(500, 'Unexpected error in the Till Helper', 'internal');
      if (!(err instanceof HttpError)) log(`Error: ${(err as Error)?.message ?? String(err)}`);
      else if (e.status >= 500) log(e.message);
      if (res.headersSent) return res.end();
      const origin = typeof req.headers.origin === 'string' && allowed.has(req.headers.origin) ? req.headers.origin : null;
      const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', vary: 'Origin' };
      if (origin) headers['access-control-allow-origin'] = origin;
      res.writeHead(e.status, headers);
      res.end(JSON.stringify({ ok: false, error: e.message, code: e.code }));
    });
  });
}

/** Starts the service on 127.0.0.1 only. */
export function listenLocal(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.off('error', reject);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
