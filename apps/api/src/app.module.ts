// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
