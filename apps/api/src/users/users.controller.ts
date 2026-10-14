// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type CreateUserInput,
  createUserSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type UpdateUserInput,
  updateUserSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermission('users.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('users.manage')
  create(@Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput, @ReqActor() actor: Actor) {
    return this.users.create(input, actor);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
    @ReqActor() actor: Actor,
  ) {
    return this.users.update(id, input, actor);
  }

  @Post(':id/reset-password')
  @RequirePermission('users.manage')
  @HttpCode(204)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
    @ReqActor() actor: Actor,
  ) {
    await this.users.resetPassword(id, input, actor);
  }

  @Delete(':id/sessions')
  @RequirePermission('sessions.manage_others')
  async endSessions(@Param('id', ParseUUIDPipe) id: string, @ReqActor() actor: Actor) {
    return { ended: await this.users.endSessions(id, actor) };
  }
}
