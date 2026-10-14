// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type CreateRoleInput, createRoleSchema, type UpdateRoleInput, updateRoleSchema } from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { RolesService } from './roles.service.js';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Any logged-in user may read the permission list (it has no business data). */
  @Get('permissions')
  permissions() {
    return this.roles.listPermissions();
  }

  /** Users with users.view need the role list to show who has what. */
  @Get('roles')
  @RequirePermission('users.view')
  list() {
    return this.roles.list();
  }

  @Get('roles/:id')
  @RequirePermission('users.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  create(@Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput, @ReqActor() actor: Actor) {
    return this.roles.create(input, actor);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) input: UpdateRoleInput,
    @ReqActor() actor: Actor,
  ) {
    return this.roles.update(id, input, actor);
  }
}
