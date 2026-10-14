// Copyright (c) 2026, Rademics. All rights reserved.
// Password hashing with scrypt from Node's own crypto module: no third-party
// package, and a memory-hard function as recommended for password storage.
import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format: scrypt$N$r$p$salt$hash (salt and hash base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await derive(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Policy from SecuritySettings; returns a reason or null when acceptable. */
export function passwordProblem(password: string, minLength: number): string | null {
  if (password.length < minLength) return `Password must be at least ${minLength} characters`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain both letters and digits';
  }
  if (/^(.)\1+$/.test(password)) return 'Password is too repetitive';
  return null;
}
