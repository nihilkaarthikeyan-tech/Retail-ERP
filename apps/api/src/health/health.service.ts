// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable } from '@nestjs/common';
import { type HealthStatus, overallStatus } from 'shared';
import { PrismaService } from '../prisma/prisma.service.js';

const API_VERSION = '0.0.1';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthStatus> {
    const database: HealthStatus['database'] = { connected: false };
    try {
      const rows = await this.prisma.$queryRaw<
        { version: string; now: Date }[]
      >`SELECT current_setting('server_version') AS version, now() AS now`;
      database.connected = true;
      database.serverVersion = rows[0].version;
      database.serverTime = rows[0].now.toISOString();
    } catch (err) {
      database.error = err instanceof Error ? err.message : String(err);
    }
    return {
      status: overallStatus(database.connected),
      api: { version: API_VERSION, time: new Date().toISOString() },
      database,
    };
  }
}
