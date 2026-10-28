// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { GstinCheckController } from './gstin-check.controller.js';
import { GstinCheckService } from './gstin-check.service.js';

/** Plan 15: GSTIN checks with the GST network, for customers and suppliers. */
@Global()
@Module({
  controllers: [GstinCheckController],
  providers: [GstinCheckService],
  exports: [GstinCheckService],
})
export class GstinCheckModule {}
