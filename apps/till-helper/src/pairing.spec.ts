// Copyright (c) 2026, Rademics. All rights reserved.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPairing, MAX_CODE_ATTEMPTS, newPairingCode, Pairing, sameSecret } from './pairing.js';

describe('pairing', () => {
  it('makes 6-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(newPairingCode()).toMatch(/^\d{6}$/);
  });

  it('compares secrets exactly', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
  });

  it('swaps the code for the token once', () => {
    const p = new Pairing('t'.repeat(43), '123456');
    expect(p.redeem('123456')).toEqual({ ok: true, token: 't'.repeat(43) });
    expect(p.redeem('123456')).toEqual({ ok: false, reason: 'used' });
  });

  it('locks the code after too many wrong tries', () => {
    const p = new Pairing('t'.repeat(43), '123456');
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) expect(p.redeem('000000')).toEqual({ ok: false, reason: 'wrong' });
    expect(p.redeem('000000')).toEqual({ ok: false, reason: 'locked' });
    expect(p.redeem('123456')).toEqual({ ok: false, reason: 'locked' });
  });

  it('keeps the token across restarts with a new code each time, and can reset it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'till-helper-')), 'till-helper.pairing.json');
    const first = loadPairing(file);
    expect(first.createdToken).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.token).toBe(first.pairing.token);
    expect(saved.pairingCode).toBe(first.pairing.pendingCode);

    const second = loadPairing(file);
    expect(second.createdToken).toBe(false);
    expect(second.pairing.token).toBe(first.pairing.token);

    const reset = loadPairing(file, true);
    expect(reset.createdToken).toBe(true);
    expect(reset.pairing.token).not.toBe(first.pairing.token);
  });
});
