// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 rule 4: the server respects the module switches. A route marked
// @RequireModule('variants') is refused with 403 and a plain message
// ("Sizes and colours is switched off in Settings → My modules") while that
// module is off, so a hidden feature cannot be used by mistake (for example
// an old till still offering a hidden button). Runs after the login and
// permission checks (route guards come after the global ones).
import { applyDecorators, type CanActivate, type ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuleKey } from 'shared';
import { ModulesService } from './modules.service.js';

export const REQUIRED_MODULES = 'requiredModules';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: ModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = this.reflector.getAllAndMerge<ModuleKey[]>(REQUIRED_MODULES, [context.getHandler(), context.getClass()]);
    if (keys.length) await this.modules.assertOn(...keys);
    return true;
  }
}

/** The route belongs only to these optional modules (all must be on). On a class: every route of the controller. */
export const RequireModule = (...keys: ModuleKey[]) => applyDecorators(SetMetadata(REQUIRED_MODULES, keys), UseGuards(ModuleGuard));
