// Copyright (c) 2026, Rademics. All rights reserved.
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthStatus } from 'shared';
import { HealthService } from './health.service.js';

/**
 * Public, read-only liveness check. It returns no business data, so it is
 * the one endpoint that will not require a logged-in user.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    const result = await this.health.check();
    if (result.status !== 'ok') res.status(503);
    return result;
  }
}
