// Copyright (c) 2026, Rademics. All rights reserved.
// GST common core (plan 08 §2, §5): settings, approval, rates and place of supply.
// Import this module to use GstCoreService (till, purchases, GST reports).
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { GstCoreController } from './gst-core.controller.js';
import { GstCoreService } from './gst-core.service.js';

@Module({
  imports: [CompanyModule],
  controllers: [GstCoreController],
  providers: [GstCoreService],
  exports: [GstCoreService],
})
export class GstCoreModule {}
