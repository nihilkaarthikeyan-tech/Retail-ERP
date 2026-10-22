// Copyright (c) 2026, Rademics. All rights reserved.
import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PLATFORM_COOKIE, type PlatformAdminUser, PlatformAuthService } from './platform-auth.service.js';

type PlatformRequest = Request & { platformAdmin?: PlatformAdminUser };

/** Plan 14: the Retail ERP admin screen needs a live admin session (its own cookie). */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[PLATFORM_COOKIE];
    const admin = token ? await this.auth.adminForToken(token) : null;
    if (!admin) throw new UnauthorizedException('Not logged in as Retail ERP admin');
    req.platformAdmin = admin;
    return true;
  }
}

export const ReqPlatformAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformAdminUser => {
  const admin = ctx.switchToHttp().getRequest<PlatformRequest>().platformAdmin;
  if (!admin) throw new Error('ReqPlatformAdmin used without PlatformGuard');
  return admin;
});
