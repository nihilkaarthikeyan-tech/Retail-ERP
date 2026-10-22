// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { PrismaService, SystemPrisma } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, SystemPrisma],
  exports: [PrismaService, SystemPrisma],
})
export class PrismaModule {}
