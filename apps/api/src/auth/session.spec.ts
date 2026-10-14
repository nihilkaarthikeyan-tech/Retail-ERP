// Copyright (c) 2026, Rademics. All rights reserved.
import { absoluteExpiry, hashSessionToken, isSessionLive, lockoutUntil, newSessionToken } from './session.js';

const limits = { idleMinutes: 30, maxHours: 12 };
const t0 = new Date('2026-10-14T09:00:00Z');
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

function session(overrides: Partial<Parameters<typeof isSessionLive>[0]> = {}) {
  return { createdAt: t0, lastActiveAt: t0, expiresAt: absoluteExpiry(t0, limits), revokedAt: null, ...overrides };
}

describe('sessions', () => {
  it('tokens are random and stored hashed', () => {
    const a = newSessionToken();
    expect(a).not.toBe(newSessionToken());
    expect(hashSessionToken(a)).toHaveLength(64);
    expect(hashSessionToken(a)).not.toContain(a);
  });

  it('ends after 30 idle minutes', () => {
    expect(isSessionLive(session(), limits, minutes(29))).toBe(true);
    expect(isSessionLive(session(), limits, minutes(30))).toBe(false);
  });

  it('ends after 12 hours even when active', () => {
    const active = session({ lastActiveAt: minutes(12 * 60 - 1) });
    expect(isSessionLive(active, limits, minutes(12 * 60 - 1))).toBe(true);
    expect(isSessionLive(active, limits, minutes(12 * 60))).toBe(false);
  });

  it('is dead once revoked', () => {
    expect(isSessionLive(session({ revokedAt: minutes(1) }), limits, minutes(2))).toBe(false);
  });

  it('locks after the configured number of failures', () => {
    expect(lockoutUntil(4, 5, 900, t0)).toBeNull();
    expect(lockoutUntil(5, 5, 900, t0)).toEqual(minutes(15));
  });
});
