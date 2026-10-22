// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type PlatformLoginInput, platformLoginSchema, type PlatformShopSwitchInput, platformShopSwitchSchema } from 'shared';
import { Public } from '../auth/decorators.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { PLATFORM_COOKIE, PLATFORM_LIMITS, type PlatformAdminUser, PlatformAuthService } from './platform-auth.service.js';
import { PlatformGuard, ReqPlatformAdmin } from './platform.guard.js';
import { PlatformService } from './platform.service.js';

const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const leadHandledSchema = z.object({ handled: z.boolean() });

/**
 * Plan 14: the Retail ERP admin (people who run the service). These routes are not
 * part of any shop, so the shops' session guard is skipped (@Public) and the
 * admin's own guard applies instead.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly platform: PlatformService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(platformLoginSchema)) input: PlatformLoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, admin } = await this.auth.login(input.email, input.password, clientIp(req));
    res.cookie(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/', maxAge: PLATFORM_LIMITS.maxHours * 3_600_000 });
    return admin;
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@ReqPlatformAdmin() admin: PlatformAdminUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(admin.sessionId);
    res.clearCookie(PLATFORM_COOKIE, { path: '/' });
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Get('me')
  me(@ReqPlatformAdmin() admin: PlatformAdminUser) {
    return { id: admin.id, email: admin.email, name: admin.name };
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Get('shops')
  shops() {
    return this.platform.shops();
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Patch('shops/:id')
  switchShop(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(platformShopSwitchSchema)) input: PlatformShopSwitchInput, @ReqPlatformAdmin() admin: PlatformAdminUser, @Req() req: Request) {
    return this.platform.setShopActive(id, input.active, input.reason, admin, clientIp(req));
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Get('leads')
  leads() {
    return this.platform.leads();
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Patch('leads/:id')
  handleLead(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(leadHandledSchema)) input: { handled: boolean }) {
    return this.platform.setLeadHandled(id, input.handled);
  }
}
