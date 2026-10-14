// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type CreateFinancialYearInput,
  createFinancialYearSchema,
  type UpdateFinancialYearInput,
  updateFinancialYearSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { FinancialYearsService } from './financial-years.service.js';

@Controller('financial-years')
export class FinancialYearsController {
  constructor(private readonly years: FinancialYearsService) {}

  /** Financial years are company settings; cashiers have no reason to list them. */
  @Get()
  @RequirePermission('company.view')
  list() {
    return this.years.list();
  }

  @Post()
  @RequirePermission('financial_years.manage')
  create(
    @Body(new ZodValidationPipe(createFinancialYearSchema)) input: CreateFinancialYearInput,
    @ReqActor() actor: Actor,
  ) {
    return this.years.create(input, actor);
  }

  @Patch(':id')
  @RequirePermission('financial_years.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFinancialYearSchema)) input: UpdateFinancialYearInput,
    @ReqActor() actor: Actor,
  ) {
    return this.years.update(id, input, actor);
  }
}
