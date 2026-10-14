// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type CreateGstRegistrationInput,
  createGstRegistrationSchema,
  type UpdateCompanyInput,
  updateCompanySchema,
  type UpdateGstRegistrationInput,
  updateGstRegistrationSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CompanyService } from './company.service.js';

@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @RequirePermission('company.view')
  get() {
    return this.company.get();
  }

  @Patch()
  @RequirePermission('company.manage')
  update(@Body(new ZodValidationPipe(updateCompanySchema)) input: UpdateCompanyInput, @ReqActor() actor: Actor) {
    return this.company.update(input, actor);
  }

  @Get('gst-registrations')
  @RequirePermission('company.view')
  gstRegistrations() {
    return this.company.listGstRegistrations();
  }

  @Post('gst-registrations')
  @RequirePermission('company.manage')
  createGstRegistration(
    @Body(new ZodValidationPipe(createGstRegistrationSchema)) input: CreateGstRegistrationInput,
    @ReqActor() actor: Actor,
  ) {
    return this.company.createGstRegistration(input, actor);
  }

  @Patch('gst-registrations/:id')
  @RequirePermission('company.manage')
  updateGstRegistration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateGstRegistrationSchema)) input: UpdateGstRegistrationInput,
    @ReqActor() actor: Actor,
  ) {
    return this.company.updateGstRegistration(id, input, actor);
  }
}
