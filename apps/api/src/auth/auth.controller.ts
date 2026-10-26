// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type ChangePasswordInput, changePasswordSchema, type ConfirmEmailInput, confirmEmailSchema, type CurrentUser, type ForgotPasswordInput, forgotPasswordSchema, type LoginInput, loginSchema, type NewPasswordByLinkInput, newPasswordByLinkSchema } from 'shared';
import { type Actor, type AuthUser, clientIp, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { AllowPasswordChangePending, Public } from './decorators.js';
import { EmailLinksService } from './email-links.service.js';
import { SESSION_COOKIE } from './session.js';

const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

/** The session cookie set at login and at sign-up. */
export function setSessionCookie(res: Response, token: string, sessionMaxHours: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: sessionMaxHours * 3_600_000,
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly links: EmailLinksService,
  ) {}

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
    setSessionCookie(res, token, (await this.auth.securitySettings()).sessionMaxHours);
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

  // ---- Emailed links (owner, 26 October 2026) ----

  /** Always 200 with the same answer, whether or not the email has an account. */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) input: ForgotPasswordInput, @Req() req: Request): Promise<{ ok: true }> {
    await this.links.forgotPassword(input, clientIp(req));
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async newPasswordByLink(@Body(new ZodValidationPipe(newPasswordByLinkSchema)) input: NewPasswordByLinkInput, @Req() req: Request) {
    await this.links.newPasswordByLink(input, clientIp(req));
  }

  @Public()
  @Post('confirm-email')
  @HttpCode(204)
  async confirmEmail(@Body(new ZodValidationPipe(confirmEmailSchema)) input: ConfirmEmailInput, @Req() req: Request) {
    await this.links.confirmEmail(input, clientIp(req));
  }

  @AllowPasswordChangePending()
  @Post('resend-confirmation')
  @HttpCode(200)
  resendConfirmation(@ReqUser() user: AuthUser, @Req() req: Request) {
    return this.links.resendConfirmation(user, clientIp(req));
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
