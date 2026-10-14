// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { overallStatus } from './health.js';

describe('overallStatus', () => {
  it('is ok when the database is connected', () => {
    expect(overallStatus(true)).toBe('ok');
  });

  it('is error when the database is not connected', () => {
    expect(overallStatus(false)).toBe('error');
  });
});
