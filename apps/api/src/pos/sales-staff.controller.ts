// Copyright (c) 2026, Rademics. All rights reserved.
// Sales staff endpoints (plan 11 C1). Store rights are checked in the service (rule 11).
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { type SalesStaffInput, salesStaffSchema, type UpdateSalesStaffInput, updateSalesStaffSchema } from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SalesStaffService } from './sales-staff.service.js';
import { RequireModule } from '../modules/require-module.js';

const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@RequireModule('salesperson')
@Controller('sales-staff')
export class SalesStaffController {
  constructor(private readonly staff: SalesStaffService) {}

  @Get() @RequireAnyPermission('sales_staff.manage', 'pos.sell', 'pos.reports') list(@ReqUser() user: AuthUser, @Query('storeId', new ParseUUIDPipe({ optional: true })) storeId?: string, @Query('active') active?: string) {
    return this.staff.list(user, storeId, active !== 'true');
  }
  @Post() @RequirePermission('sales_staff.manage') create(@Body(zod(salesStaffSchema)) input: SalesStaffInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.staff.create(input, actor, user);
  }
  @Patch(':id') @RequirePermission('sales_staff.manage') update(@Param('id', new ParseUUIDPipe()) id: string, @Body(zod(updateSalesStaffSchema)) input: UpdateSalesStaffInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.staff.update(id, input, actor, user);
  }
}
