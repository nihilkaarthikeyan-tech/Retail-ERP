// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type CurrentUser, type SetupInput, type SetupProgressInput, setupFinishSchema, setupProgressSchema, setupSchema, type SignupInput, signupSchema } from 'shared';
import { setSessionCookie } from '../auth/auth.controller.js';
import { AllowPasswordChangePending, Public } from '../auth/decorators.js';
import { type AuthUser, clientIp, ReqUser } from '../common/request-context.js';
import { RateLimit } from '../auth/rate-limit.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SetupService } from './setup.service.js';

/** Plan 14: a new shop signs up (anyone may), then its owner sets it up (logged in). */
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  /** Does the logged-in person's shop still need the guided setup? */
  @AllowPasswordChangePending()
  @Get('status')
  status() {
    return this.setup.status();
  }

  /** One-step setup: a complete shop in a single call (kept for the API and the tests). */
  @Public()
  @Post()
  run(@Body(new ZodValidationPipe(setupSchema)) input: SetupInput, @Req() req: Request) {
    return this.setup.run(input, clientIp(req));
  }

  /** Plan 12 §3: the guided setup's saved answers and the step to come back to. */
  @Get('progress')
  progress(@ReqUser() user: AuthUser) {
    return this.setup.progress(user);
  }

  @Put('progress')
  saveProgress(@ReqUser() user: AuthUser, @Body(new ZodValidationPipe(setupProgressSchema)) input: SetupProgressInput) {
    return this.setup.saveProgress(user, input);
  }

  /** The last step: fills in the shop from the saved answers. */
  @Post('finish')
  finish(@ReqUser() user: AuthUser, @Body(new ZodValidationPipe(setupFinishSchema)) _input: object, @Req() req: Request) {
    return this.setup.finish(user, clientIp(req));
  }
}

/** Plan 14: sign-up makes the shop and logs its owner in. */
@Controller('auth')
export class SignupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @RateLimit('signup')
  @Post('signup')
  @HttpCode(201)
  async signup(@Body(new ZodValidationPipe(signupSchema)) input: SignupInput, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<CurrentUser> {
    const { token, user, sessionMaxHours } = await this.setup.signup(input, { ipAddress: clientIp(req), userAgent: req.headers['user-agent'] ?? null });
    setSessionCookie(res, token, sessionMaxHours);
    return user;
  }
}
