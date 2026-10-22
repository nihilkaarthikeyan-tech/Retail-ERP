// Copyright (c) 2026, Rademics. All rights reserved.
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUser } from 'shared';

/** The logged-in user as attached to the request by the session guard. */
export interface AuthUser extends CurrentUser {
  sessionId: string;
  /** Plan 14: the shop the person belongs to (from their session, never from the browser). */
  companyId: string;
}

/** Who is doing something and from where, passed to services for audit rows. */
export interface Actor {
  userId: string | null;
  ipAddress: string | null;
}

export type RequestWithUser = Request & { user?: AuthUser };

export function actorFromRequest(req: RequestWithUser): Actor {
  return { userId: req.user?.id ?? null, ipAddress: clientIp(req) };
}

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export const ReqUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.user) throw new Error('ReqUser used on a route without a logged-in user');
  return req.user;
});

export const ReqActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  return actorFromRequest(ctx.switchToHttp().getRequest<RequestWithUser>());
});
