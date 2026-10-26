// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { ClientErrorsController } from './client-errors.controller.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController, ClientErrorsController],
  providers: [HealthService],
})
export class HealthModule {}
