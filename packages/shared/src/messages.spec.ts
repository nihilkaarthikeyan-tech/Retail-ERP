// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './messages.js';
import { updateCompanySchema } from './schemas/index.js';

const first = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0].message;
};

describe('plain messages for the standard checks', () => {
  it('an empty required text says to fill it in', () => {
    expect(first(z.string().trim().min(1), '  ')).toBe('Please fill this in');
    expect(first(z.object({ name: z.string() }), {})).toBe('Please fill this in');
  });

  it('lengths, numbers, lists and choices are in plain words', () => {
    expect(first(z.string().min(8), 'abc')).toBe('Use at least 8 characters');
    expect(first(z.string().max(5), 'abcdefg')).toBe('Use at most 5 characters');
    expect(first(z.number().min(0), -1)).toBe('Must be 0 or more');
    expect(first(z.number(), 'x')).toBe('Must be a number');
    expect(first(z.array(z.string()).min(1), [])).toBe('Add at least one');
    expect(first(z.enum(['a', 'b']), 'c')).toBe('Please choose one from the list');
    expect(first(z.string().uuid(), 'x')).toBe('Please choose one from the list');
    expect(first(z.string().email(), 'x')).toBe('Not a valid email address');
  });

  it('a message written on the rule itself still wins', () => {
    expect(first(z.string().min(1, 'Type the item name'), '')).toBe('Type the item name');
  });

  it('the company form no longer shows the technical wording', () => {
    const r = updateCompanySchema.safeParse({ legalName: '', stateCode: '33' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).not.toContain(expect.stringMatching(/Too small|expected/));
  });
});
