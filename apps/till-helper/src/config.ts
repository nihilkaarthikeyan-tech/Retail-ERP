// Copyright (c) 2026, Rademics. All rights reserved.
// Settings of the helper on this till, kept in till-helper.config.json next
// to the program. Created with safe defaults on first start.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PaperWidth } from './receipt.js';

export const DEFAULT_PORT = 47120;

export type PrinterConfig =
  | { kind: 'none' }
  /** Network printer: raw bytes to its IP address, port 9100. */
  | { kind: 'network'; host: string; port?: number }
  /** USB printer installed in Windows and shared under a short share name. */
  | { kind: 'windows'; share: string }
  /** Serial printer on a COM port. */
  | { kind: 'serial'; port: string; baudRate?: number };

export interface HelperConfig {
  /** Port on 127.0.0.1 (the helper never listens on other addresses). */
  port: number;
  /** ERP web addresses allowed to use the helper, e.g. "https://erp.ourcompany.in". */
  allowedOrigins: string[];
  paperWidth: PaperWidth;
  printer: PrinterConfig;
  /** Cash drawer plugged into the receipt printer's drawer socket. */
  drawer: { enabled: boolean; pin: 2 | 5 };
}

export const DEFAULT_CONFIG: HelperConfig = {
  port: DEFAULT_PORT,
  allowedOrigins: ['http://localhost:3000'],
  paperWidth: 80,
  printer: { kind: 'none' },
  drawer: { enabled: true, pin: 2 },
};

export class ConfigError extends Error {}

/** A share name or COM port is put into a Windows command, so only plain characters are allowed. */
const SHARE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/;
const COM_PORT = /^COM[0-9]{1,3}$/i;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;

/** Normalises an origin ("http://localhost:3000/" → "http://localhost:3000"); throws if it is not one. */
export function normaliseOrigin(value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new ConfigError(`"${value}" is not a web address`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError(`"${value}" must start with http:// or https://`);
  if (u.pathname !== '/' || u.search || u.hash || u.username) {
    throw new ConfigError(`"${value}" must be only the address of the ERP (no path), e.g. https://erp.example.in`);
  }
  return u.origin;
}

/** Checks a settings object and fills in defaults. Throws ConfigError with a plain message. */
export function parseConfig(input: unknown): HelperConfig {
  if (typeof input !== 'object' || input === null) throw new ConfigError('settings must be a JSON object');
  const raw = input as Record<string, unknown>;

  const port = raw.port ?? DEFAULT_PORT;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError('port must be a whole number between 1024 and 65535');
  }

  const origins = raw.allowedOrigins ?? DEFAULT_CONFIG.allowedOrigins;
  if (!Array.isArray(origins) || origins.length === 0 || !origins.every((o) => typeof o === 'string')) {
    throw new ConfigError('allowedOrigins must list at least one ERP web address');
  }
  const allowedOrigins = origins.map((o: string) => normaliseOrigin(o));

  const paperWidth = raw.paperWidth ?? 80;
  if (paperWidth !== 80 && paperWidth !== 58) throw new ConfigError('paperWidth must be 80 or 58');

  const printer = parsePrinter(raw.printer ?? { kind: 'none' });

  const d = (raw.drawer ?? {}) as Record<string, unknown>;
  const enabled = d.enabled ?? true;
  const pin = d.pin ?? 2;
  if (typeof enabled !== 'boolean') throw new ConfigError('drawer.enabled must be true or false');
  if (pin !== 2 && pin !== 5) throw new ConfigError('drawer.pin must be 2 or 5');

  return { port, allowedOrigins, paperWidth, printer, drawer: { enabled, pin } };
}

function parsePrinter(input: unknown): PrinterConfig {
  if (typeof input !== 'object' || input === null) throw new ConfigError('printer must be an object');
  const p = input as Record<string, unknown>;
  switch (p.kind) {
    case 'none':
      return { kind: 'none' };
    case 'network': {
      if (typeof p.host !== 'string' || !HOST.test(p.host)) throw new ConfigError('printer.host must be the printer IP address');
      const port = p.port ?? 9100;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError('printer.port must be a port number (usually 9100)');
      }
      return { kind: 'network', host: p.host, port };
    }
    case 'windows':
      if (typeof p.share !== 'string' || !SHARE_NAME.test(p.share)) {
        throw new ConfigError('printer.share must be the printer share name (letters, digits, space, _ . -)');
      }
      return { kind: 'windows', share: p.share };
    case 'serial': {
      if (typeof p.port !== 'string' || !COM_PORT.test(p.port)) throw new ConfigError('printer.port must be a COM port such as COM3');
      const baudRate = p.baudRate ?? 9600;
      if (typeof baudRate !== 'number' || ![2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(baudRate)) {
        throw new ConfigError('printer.baudRate must be a standard speed such as 9600 or 115200');
      }
      return { kind: 'serial', port: p.port.toUpperCase(), baudRate };
    }
    default:
      throw new ConfigError("printer.kind must be 'none', 'network', 'windows' or 'serial'");
  }
}

/** Reads the settings file, creating it with defaults if it does not exist yet. */
export function loadConfig(path: string): { config: HelperConfig; created: boolean } {
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
    return { config: DEFAULT_CONFIG, created: true };
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new ConfigError(`${path} is not valid JSON`);
  }
  return { config: parseConfig(json), created: false };
}
