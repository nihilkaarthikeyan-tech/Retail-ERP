// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier sale-or-return endpoints (plan 11 part 2 §3). Every route checks a
// permission here and the store rights inside the service (rule 11).
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type ConsignmentBillInput,
  consignmentBillSchema,
  type ConsignmentStatementQuery,
  consignmentStatementQuerySchema,
  type ConsignmentStockQuery,
  consignmentStockQuerySchema,
  type CreateConsignmentStatementInput,
  createConsignmentStatementSchema,
  type ReasonInput,
  reasonSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ConsignmentService } from './consignment.service.js';

const id = () => new ParseUUIDPipe();

@Controller('purchase/consignment')
export class ConsignmentController {
  constructor(private readonly consignment: ConsignmentService) {}

  @Get('stock') @RequirePermission('purchase.view') stock(@Query(new ZodValidationPipe(consignmentStockQuerySchema)) q: ConsignmentStockQuery, @ReqUser() user: AuthUser) {
    return this.consignment.stockBySupplier(q, user);
  }
  @Get('check') @RequirePermission('accounts.view') check() {
    return this.consignment.balanceCheck();
  }
  @Get('statements') @RequirePermission('purchase.view') list(@Query(new ZodValidationPipe(consignmentStatementQuerySchema)) q: ConsignmentStatementQuery, @ReqUser() user: AuthUser) {
    return this.consignment.list(q, user);
  }
  @Post('statements') @RequirePermission('purchase.bill') create(@Body(new ZodValidationPipe(createConsignmentStatementSchema)) input: CreateConsignmentStatementInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.consignment.create(input, actor, user);
  }
  @Get('statements/:id') @RequirePermission('purchase.view') get(@Param('id', id()) statementId: string, @ReqUser() user: AuthUser) {
    return this.consignment.get(statementId, user);
  }
  @Post('statements/:id/bill') @HttpCode(200) @RequirePermission('purchase.bill') bill(@Param('id', id()) statementId: string, @Body(new ZodValidationPipe(consignmentBillSchema)) input: ConsignmentBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.consignment.makeBill(statementId, input, actor, user);
  }
  @Post('statements/:id/cancel') @HttpCode(200) @RequirePermission('purchase.bill') cancel(@Param('id', id()) statementId: string, @Body(new ZodValidationPipe(reasonSchema)) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.consignment.cancel(statementId, input.reason, actor, user);
  }
}
