// Copyright (c) 2026, Rademics. All rights reserved.
import { hashPassword, passwordProblem, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('Correct-horse-9');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('Correct-horse-9');
    expect(await verifyPassword('Correct-horse-9', stored)).toBe(true);
    expect(await verifyPassword('correct-horse-9', stored)).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('Same-pass-1')).not.toBe(await hashPassword('Same-pass-1'));
  });

  it('refuses malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('password policy', () => {
  it('enforces length and a mix of letters and digits', () => {
    expect(passwordProblem('short1', 10)).toMatch(/at least 10/);
    expect(passwordProblem('onlyletterslong', 10)).toMatch(/letters and digits/);
    expect(passwordProblem('1111111111', 10)).toMatch(/letters and digits/);
    expect(passwordProblem('Good-enough-42', 10)).toBeNull();
  });
});
