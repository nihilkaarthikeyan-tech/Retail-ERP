// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { type SetupInput, setupSchema } from 'shared';
import { Public } from '../auth/decorators.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SetupService } from './setup.service.js';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get('status')
  status() {
    return this.setup.status();
  }

  /** Public only while no company exists; the service refuses it afterwards. */
  @Public()
  @Post()
  run(@Body(new ZodValidationPipe(setupSchema)) input: SetupInput, @Req() req: Request) {
    return this.setup.run(input, clientIp(req));
  }
}
