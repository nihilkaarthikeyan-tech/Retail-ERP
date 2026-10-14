// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type CreateStoreInput, createStoreSchema, type UpdateStoreInput, updateStoreSchema } from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { StoresService } from './stores.service.js';

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @RequirePermission('stores.view')
  list(@ReqUser() user: AuthUser) {
    return this.stores.list(user);
  }

  @Get(':id')
  @RequirePermission('stores.view')
  get(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser) {
    return this.stores.get(id, user);
  }

  @Post()
  @RequirePermission('stores.manage')
  create(@Body(new ZodValidationPipe(createStoreSchema)) input: CreateStoreInput, @ReqActor() actor: Actor) {
    return this.stores.create(input, actor);
  }

  @Patch(':id')
  @RequirePermission('stores.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStoreSchema)) input: UpdateStoreInput,
    @ReqUser() user: AuthUser,
    @ReqActor() actor: Actor,
  ) {
    return this.stores.update(id, input, user, actor);
  }
}
