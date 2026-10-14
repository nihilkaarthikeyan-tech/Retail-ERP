// Copyright (c) 2026, Rademics. All rights reserved.
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithUser } from '../common/request-context.js';
import { AuthService } from './auth.service.js';
import { ALLOW_PASSWORD_CHANGE_PENDING, IS_PUBLIC } from './decorators.js';
import { SESSION_COOKIE } from './session.js';

/**
 * Global guard: every route needs a live session unless marked @Public().
 * Browser mutations must come from an allowed origin (CSRF check); the
 * session cookie is SameSite=Lax as a second line of defence.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<RequestWithUser>();

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin && !this.auth.isAllowedOrigin(origin)) {
        throw new ForbiddenException('Request origin not allowed');
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not logged in');

    const user = await this.auth.userForSessionToken(token);
    if (!user) throw new UnauthorizedException('Session expired or ended');
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, targets)) {
      throw new ForbiddenException({ message: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return true;
  }
}
