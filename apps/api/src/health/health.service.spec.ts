// Copyright (c) 2026, Rademics. All rights reserved.
import { HealthService } from './health.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function serviceWith(queryRaw: () => Promise<unknown>): HealthService {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService', () => {
  it('reports ok with the database version when the query succeeds', async () => {
    const now = new Date('2026-10-14T10:00:00.000Z');
    const result = await serviceWith(async () => [{ version: '17.6', now }]).check();

    expect(result.status).toBe('ok');
    expect(result.database).toEqual({
      connected: true,
      serverVersion: '17.6',
      serverTime: '2026-10-14T10:00:00.000Z',
    });
  });

  it('reports error with the reason when the database is unreachable', async () => {
    const result = await serviceWith(async () => {
      throw new Error('connection refused');
    }).check();

    expect(result.status).toBe('error');
    expect(result.database).toEqual({ connected: false, error: 'connection refused' });
  });
});
