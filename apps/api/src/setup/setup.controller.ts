// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { type SetupFinishInput, setupFinishSchema, type SetupInput, type SetupProgressInput, setupProgressSchema, setupSchema } from 'shared';
import { Public } from '../auth/decorators.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SetupService } from './setup.service.js';

/** Every route here is public only while no company exists; the service refuses them afterwards. */
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get('status')
  status() {
    return this.setup.status();
  }

  /** One-page setup in a single call (kept for the API and the tests). */
  @Public()
  @Post()
  run(@Body(new ZodValidationPipe(setupSchema)) input: SetupInput, @Req() req: Request) {
    return this.setup.run(input, clientIp(req));
  }

  /** Plan 12 §3: the guided setup's saved answers and the step to come back to. */
  @Public()
  @Get('progress')
  progress() {
    return this.setup.progress();
  }

  @Public()
  @Put('progress')
  saveProgress(@Body(new ZodValidationPipe(setupProgressSchema)) input: SetupProgressInput) {
    return this.setup.saveProgress(input);
  }

  /** The last step: the password, then everything is created in one go. */
  @Public()
  @Post('finish')
  finish(@Body(new ZodValidationPipe(setupFinishSchema)) input: SetupFinishInput, @Req() req: Request) {
    return this.setup.finish(input.password, clientIp(req));
  }
}
