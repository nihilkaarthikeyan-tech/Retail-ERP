// Copyright (c) 2026, Rademics. All rights reserved.
// Customer orders and alteration jobs (plan 11 part 2). Rights are checked here,
// store rights and the registered till computer inside the services (rule 11).
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type AlterationJobInput,
  alterationJobSchema,
  type AlterationQuery,
  alterationQuerySchema,
  type AlterationStatusInput,
  alterationStatusSchema,
  type CancelOrderInput,
  cancelOrderSchema,
  type CustomerOrderInput,
  customerOrderQuerySchema,
  type CustomerOrderQuery,
  customerOrderSchema,
  type OfficeAdvanceInput,
  officeAdvanceSchema,
  type TillAdvanceInput,
  tillAdvanceSchema,
  type TillCancelOrderInput,
  tillCancelOrderSchema,
} from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { TILL_TOKEN_HEADER } from '../pos/pos-common.service.js';
import { AlterationsService } from './alterations.service.js';
import { OrdersService } from './orders.service.js';
import { RequireModule } from '../modules/require-module.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly alterations: AlterationsService,
  ) {}

  // ---- Customer orders ----
  @Get('orders') @RequireModule('customer_orders') @RequirePermission('orders.manage') list(@Query(zod(customerOrderQuerySchema)) q: CustomerOrderQuery, @ReqUser() user: AuthUser) {
    return this.orders.list(q, user);
  }
  @Get('orders/credit/:customerId') @RequireModule('customer_orders') @RequireAnyPermission('orders.manage', 'pos.sell') credit(@Param('customerId', id()) customerId: string) {
    return this.orders.customerCredit(customerId);
  }
  @Get('orders/:id') @RequireModule('customer_orders') @RequirePermission('orders.manage') get(@Param('id', id()) orderId: string, @ReqUser() user: AuthUser) {
    return this.orders.get(orderId, user);
  }
  @Post('orders') @RequireModule('customer_orders') @RequirePermission('orders.manage') create(@Body(zod(customerOrderSchema)) input: CustomerOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.create(input, actor, user);
  }
  @Patch('orders/:id') @RequireModule('customer_orders') @RequirePermission('orders.manage') update(@Param('id', id()) orderId: string, @Body(zod(customerOrderSchema)) input: CustomerOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.update(orderId, input, actor, user);
  }
  @Post('orders/:id/ready') @RequireModule('customer_orders') @HttpCode(200) @RequirePermission('orders.manage') ready(@Param('id', id()) orderId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.markReady(orderId, actor, user);
  }
  @Post('orders/:id/cancel') @RequireModule('customer_orders') @HttpCode(200) @RequirePermission('orders.manage') cancel(@Param('id', id()) orderId: string, @Body(zod(cancelOrderSchema)) input: CancelOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.cancel(orderId, input, actor, user);
  }
  @Post('orders/:id/advances') @RequireModule('customer_orders') @RequirePermission('orders.manage') officeAdvance(@Param('id', id()) orderId: string, @Body(zod(officeAdvanceSchema)) input: OfficeAdvanceInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.officeAdvance(orderId, input, actor, user);
  }
  // At the till (the registered computer's token).
  @Post('pos/orders/:id/advances') @RequireModule('customer_orders') @RequirePermission('orders.manage') tillAdvance(@Param('id', id()) orderId: string, @Body(zod(tillAdvanceSchema)) input: TillAdvanceInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.orders.tillAdvance(orderId, input, actor, user, token);
  }
  @Post('pos/orders/:id/cancel') @RequireModule('customer_orders') @HttpCode(200) @RequirePermission('orders.manage') tillCancel(@Param('id', id()) orderId: string, @Body(zod(tillCancelOrderSchema)) input: TillCancelOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.orders.tillCancel(orderId, input, actor, user, token);
  }

  // ---- Alteration jobs ----
  @Get('alterations') @RequireModule('alterations') @RequirePermission('alterations.manage') listJobs(@Query(zod(alterationQuerySchema)) q: AlterationQuery, @ReqUser() user: AuthUser) {
    return this.alterations.list(q, user);
  }
  @Get('alterations/:id') @RequireModule('alterations') @RequirePermission('alterations.manage') getJob(@Param('id', id()) jobId: string, @ReqUser() user: AuthUser) {
    return this.alterations.get(jobId, user);
  }
  @Post('alterations') @RequireModule('alterations') @RequirePermission('alterations.manage') createJob(@Body(zod(alterationJobSchema)) input: AlterationJobInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.alterations.create(input, actor, user);
  }
  @Patch('alterations/:id') @RequireModule('alterations') @RequirePermission('alterations.manage') updateJob(@Param('id', id()) jobId: string, @Body(zod(alterationJobSchema)) input: AlterationJobInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.alterations.update(jobId, input, actor, user);
  }
  @Post('alterations/:id/status') @RequireModule('alterations') @HttpCode(200) @RequirePermission('alterations.manage') status(@Param('id', id()) jobId: string, @Body(zod(alterationStatusSchema)) input: AlterationStatusInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.alterations.setStatus(jobId, input, actor, user);
  }
}
