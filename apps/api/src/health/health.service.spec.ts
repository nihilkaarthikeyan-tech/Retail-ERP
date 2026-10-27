// Copyright (c) 2026, Rademics. All rights reserved.
import { Logger } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function serviceWith(queryRaw: () => Promise<unknown>): HealthService {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService', () => {
  it('reports ok and only "connected" when the query succeeds', async () => {
    const result = await serviceWith(async () => [{ '?column?': 1 }]).check();

    expect(result.status).toBe('ok');
    expect(result.database).toEqual({ connected: true });
  });

  // Code audit, 27 October 2026: anyone may ask, so the reason goes to the server log, not the answer.
  it('reports error without the reason when the database is unreachable', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const result = await serviceWith(async () => {
      throw new Error('connection refused');
    }).check();

    expect(result.status).toBe('error');
    expect(result.database).toEqual({ connected: false });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    logged.mockRestore();
  });
});
