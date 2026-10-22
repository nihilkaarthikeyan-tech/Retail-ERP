// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller.js';

/** Plan 14: what sits above the shops (landing page messages, the Rademics admin screen). */
@Module({
  controllers: [LeadsController],
})
export class PlatformModule {}
