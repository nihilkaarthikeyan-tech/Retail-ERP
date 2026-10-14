// Copyright (c) 2026, Rademics. All rights reserved.
// Pure session rules, kept free of the database so they can be unit-tested.
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'erp_session';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionTimes {
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionLimits {
  idleMinutes: number;
  maxHours: number;
}

export function absoluteExpiry(createdAt: Date, limits: SessionLimits): Date {
  return new Date(createdAt.getTime() + limits.maxHours * 3_600_000);
}

/** A session is live if not revoked, not past its absolute end, and used recently. */
export function isSessionLive(session: SessionTimes, limits: SessionLimits, now: Date): boolean {
  if (session.revokedAt) return false;
  if (now >= session.expiresAt) return false;
  const idleDeadline = session.lastActiveAt.getTime() + limits.idleMinutes * 60_000;
  return now.getTime() < idleDeadline;
}

/** Lockout rule: N failures in a row block the account for M seconds. */
export function lockoutUntil(failedCount: number, attempts: number, seconds: number, now: Date): Date | null {
  if (failedCount < attempts) return null;
  return new Date(now.getTime() + seconds * 1000);
}
