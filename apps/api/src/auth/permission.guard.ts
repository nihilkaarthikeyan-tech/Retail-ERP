// Copyright (c) 2026, Rademics. All rights reserved.
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type PermissionKey } from 'shared';
import type { RequestWithUser } from '../common/request-context.js';
import { OWNER_ADMIN_ONLY, REQUIRED_PERMISSION } from './decorators.js';

/** Runs after SessionGuard. Checks @RequirePermission and @OwnerAdminOnly. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionKey | PermissionKey[] | undefined>(REQUIRED_PERMISSION, targets);
    const ownerOnly = this.reflector.getAllAndOverride<boolean>(OWNER_ADMIN_ONLY, targets);
    if (!required && !ownerOnly) return true;

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) return false; // public route with a permission: misconfiguration
    if (ownerOnly && !user.isOwnerAdmin) throw new ForbiddenException('Only the Owner/Admin may do this');
    // A list means "any one of these rights is enough".
    const anyOf = required === undefined ? [] : Array.isArray(required) ? required : [required];
    if (anyOf.length && !anyOf.some((key) => hasPermission(user, key))) {
      throw new ForbiddenException(`You do not have the right "${anyOf.join('" or "')}"`);
    }
    return true;
  }
}
