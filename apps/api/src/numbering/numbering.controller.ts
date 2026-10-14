// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type ChangeCounterInput,
  changeCounterSchema,
  type CreateNumberSeriesInput,
  createNumberSeriesSchema,
  isIsoDate,
  type UpdateNumberSeriesInput,
  updateNumberSeriesSchema,
} from 'shared';
import { OwnerAdminOnly, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { NumberingService } from './numbering.service.js';

@Controller('number-series')
@RequirePermission('numbering.manage')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  list() {
    return this.numbering.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createNumberSeriesSchema)) input: CreateNumberSeriesInput, @ReqActor() actor: Actor) {
    return this.numbering.create(input, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateNumberSeriesSchema)) input: UpdateNumberSeriesInput,
    @ReqActor() actor: Actor,
  ) {
    return this.numbering.update(id, input, actor);
  }

  @Get(':id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser, @Query('date') date?: string) {
    return this.numbering.preview(id, user, date && isIsoDate(date) ? date : undefined);
  }

  @Patch(':id/counter')
  @OwnerAdminOnly()
  changeCounter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeCounterSchema)) input: ChangeCounterInput,
    @ReqActor() actor: Actor,
  ) {
    return this.numbering.changeCounter(id, input, actor);
  }
}
