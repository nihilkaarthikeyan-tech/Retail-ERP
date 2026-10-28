// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { OfficialHsnService } from './official-hsn.service.js';

/** The official HSN / SAC list, for the item screens and the GST returns. */
@Global()
@Module({
  providers: [OfficialHsnService],
  exports: [OfficialHsnService],
})
export class OfficialHsnModule {}
