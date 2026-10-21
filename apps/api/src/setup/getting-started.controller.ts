// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Put } from '@nestjs/common';
import { type GettingStartedVisibilityInput, gettingStartedVisibilitySchema } from 'shared';
import { OwnerAdminOnly } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { GettingStartedService } from './getting-started.service.js';

/** Plan 12 §4 and §5: the owner's getting-started checklist, and the settings the centre reads that have no API of their own. */
@Controller()
export class GettingStartedController {
  constructor(private readonly gettingStarted: GettingStartedService) {}

  @Get('getting-started')
  @OwnerAdminOnly()
  checklist(@ReqUser() user: AuthUser) {
    return this.gettingStarted.checklist(user);
  }

  @Put('getting-started')
  @OwnerAdminOnly()
  setHidden(@Body(new ZodValidationPipe(gettingStartedVisibilitySchema)) input: GettingStartedVisibilityInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.gettingStarted.setHidden(input.hidden, actor, user);
  }

  /** Read only: no screen changes the security settings yet (proposed in docs/settings-inventory.md). */
  @Get('settings/security')
  @OwnerAdminOnly()
  security(@ReqUser() user: AuthUser) {
    return this.gettingStarted.securitySettings(user);
  }
}
