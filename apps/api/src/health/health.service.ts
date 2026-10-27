// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, Logger } from '@nestjs/common';
import { type HealthStatus, overallStatus } from 'shared';
import { PrismaService } from '../prisma/prisma.service.js';

const API_VERSION = '0.0.1';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly log = new Logger(HealthService.name);

  /**
   * Anyone may ask, so only "up or not" is answered: no database version, server time or
   * database error (code audit, 27 October 2026). A failure's details go to the server log.
   */
  async check(): Promise<HealthStatus> {
    const database: HealthStatus['database'] = { connected: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database.connected = true;
    } catch (err) {
      this.log.error(`Database check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
      status: overallStatus(database.connected),
      api: { version: API_VERSION, time: new Date().toISOString() },
      database,
    };
  }
}
