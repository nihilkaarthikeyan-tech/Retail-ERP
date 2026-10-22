// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformService } from './platform.service.js';

/** Plan 14: what sits above the shops (landing page messages, the Retail ERP admin screen). */
@Module({
  controllers: [LeadsController, PlatformController],
  providers: [PlatformAuthService, PlatformService, PlatformGuard],
})
export class PlatformModule {}
