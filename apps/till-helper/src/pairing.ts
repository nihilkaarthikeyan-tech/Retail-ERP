// Copyright (c) 2026, Rademics. All rights reserved.
// Pairing the till page with the helper. The helper keeps one secret token
// (in till-helper.pairing.json, never committed). On every start it makes a
// fresh 6-digit pairing code; the till page swaps that code once for the
// token and then sends the token with every request (x-helper-token).
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const MAX_CODE_ATTEMPTS = 5;

/** Compares two secrets in constant time (also when their lengths differ). */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export class Pairing {
  private code: string | null;
  private wrongAttempts = 0;

  constructor(
    readonly token: string,
    code: string | null = newPairingCode(),
  ) {
    this.code = code;
  }

  /** The pairing code still waiting to be used, if any. */
  get pendingCode(): string | null {
    return this.code;
  }

  /** True when the request carries the right token. */
  checkToken(given: string): boolean {
    return sameSecret(given, this.token);
  }

  /**
   * Swaps the pairing code for the token. The code works once; after
   * MAX_CODE_ATTEMPTS wrong tries it stops working until the helper restarts.
   */
  redeem(code: string): { ok: true; token: string } | { ok: false; reason: 'wrong' | 'used' | 'locked' } {
    if (this.code === null) return { ok: false, reason: this.wrongAttempts >= MAX_CODE_ATTEMPTS ? 'locked' : 'used' };
    if (sameSecret(code, this.code)) {
      this.code = null;
      return { ok: true, token: this.token };
    }
    this.wrongAttempts += 1;
    if (this.wrongAttempts >= MAX_CODE_ATTEMPTS) {
      this.code = null;
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'wrong' };
  }
}

interface PairingFile {
  token: string;
  pairingCode: string;
  createdAt: string;
  note: string;
}

/**
 * Loads the token from the pairing file (creating a new one the first time or
 * when `reset` is set), makes a fresh pairing code and writes both back.
 */
export function loadPairing(path: string, reset = false): { pairing: Pairing; createdToken: boolean } {
  let token: string | null = null;
  if (!reset && existsSync(path)) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<PairingFile>;
      if (typeof saved.token === 'string' && saved.token.length >= 32) token = saved.token;
    } catch {
      token = null;
    }
  }
  const createdToken = token === null;
  const pairing = new Pairing(token ?? newToken());
  const file: PairingFile = {
    token: pairing.token,
    pairingCode: pairing.pendingCode!,
    createdAt: new Date().toISOString(),
    note: 'Secret of this till. Do not share or copy to another computer. The pairing code changes every time the helper starts.',
  };
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return { pairing, createdToken };
}
