// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type ChangePasswordInput, changePasswordSchema, type CurrentUser, type LoginInput, loginSchema } from 'shared';
import { type Actor, type AuthUser, clientIp, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { AllowPasswordChangePending, Public } from './decorators.js';
import { SESSION_COOKIE } from './session.js';

const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUser> {
    const { token, user } = await this.auth.login(input, {
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    const settings = await this.auth.securitySettings();
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: COOKIE_SECURE,
      path: '/',
      maxAge: settings.sessionMaxHours * 3_600_000,
    });
    return user;
  }

  @AllowPasswordChangePending()
  @Post('logout')
  @HttpCode(204)
  async logout(@ReqUser() user: AuthUser, @ReqActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, actor);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @AllowPasswordChangePending()
  @Get('me')
  me(@ReqUser() user: AuthUser): CurrentUser {
    const { sessionId: _ignored, ...current } = user;
    return current;
  }

  @AllowPasswordChangePending()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @ReqUser() user: AuthUser,
    @ReqActor() actor: Actor,
    @Body(new ZodValidationPipe(changePasswordSchema)) input: ChangePasswordInput,
  ) {
    await this.auth.changePassword(user, input, actor);
  }

  @Get('sessions')
  sessions(@ReqUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async endSession(@ReqUser() user: AuthUser, @ReqActor() actor: Actor, @Param('id') id: string) {
    await this.auth.endOwnSession(user, id, actor);
  }
}
