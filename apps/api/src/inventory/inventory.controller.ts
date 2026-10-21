// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CancelStockDocumentInput,
  cancelStockDocumentSchema,
  type CreateCountInput,
  createCountSchema,
  type CreateLocationInput,
  createLocationSchema,
  type CreateStockDocumentInput,
  createStockDocumentSchema,
  type ReceiveTransferInput,
  receiveTransferSchema,
  type ReorderLevelInput,
  reorderLevelSchema,
  type StockBalanceQuery,
  stockBalanceQuerySchema,
  type StockDocumentQuery,
  stockDocumentQuerySchema,
  type StockLedgerQuery,
  stockLedgerQuerySchema,
  type UpdateCountInput,
  updateCountSchema,
  type UpdateInventorySettingsInput,
  updateInventorySettingsSchema,
  type UpdateLocationInput,
  updateLocationSchema,
  type UpdateStockDocumentInput,
  updateStockDocumentSchema,
} from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { InventoryMastersService } from './inventory-masters.service.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockReportsService } from './stock-reports.service.js';
import { RequireModule } from '../modules/require-module.js';

@Controller('stock')
export class InventoryController {
  constructor(
    private readonly masters: InventoryMastersService,
    private readonly documents: StockDocumentsService,
    private readonly reports: StockReportsService,
  ) {}

  // ---- Locations ----
  @Get('locations') @RequirePermission('stock.view') locations(@ReqUser() user: AuthUser) {
    return this.masters.listLocations(user);
  }
  @Post('locations') @RequirePermission('stock.locations.manage') createLocation(@Body(new ZodValidationPipe(createLocationSchema)) input: CreateLocationInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.masters.createLocation(input, actor, user);
  }
  @Patch('locations/:id') @RequirePermission('stock.locations.manage') updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateLocationSchema)) input: UpdateLocationInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.masters.updateLocation(id, input, actor, user);
  }

  // ---- Documents (stock in, stock out, moves, transfers) ----
  @Get('documents') @RequirePermission('stock.view') list(@Query(new ZodValidationPipe(stockDocumentQuerySchema)) q: StockDocumentQuery, @ReqUser() user: AuthUser) {
    return this.documents.list(q, user);
  }
  @Post('documents') @RequireAnyPermission('stock.count', 'stock.move') create(@Body(new ZodValidationPipe(createStockDocumentSchema)) input: CreateStockDocumentInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.create(input, actor, user);
  }
  @Get('documents/:id') @RequirePermission('stock.view') get(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser) {
    return this.documents.get(id, user);
  }
  @Patch('documents/:id') @RequireAnyPermission('stock.count', 'stock.move') update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateStockDocumentSchema)) input: UpdateStockDocumentInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.update(id, input, actor, user);
  }
  @Post('documents/:id/finalise') @HttpCode(200) @RequireAnyPermission('stock.adjust_finalise', 'stock.move') finalise(@Param('id', ParseUUIDPipe) id: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.finalise(id, actor, user);
  }
  @Post('documents/:id/cancel') @HttpCode(200) @RequireAnyPermission('stock.adjust_finalise', 'stock.move', 'stock.count') cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(cancelStockDocumentSchema)) input: CancelStockDocumentInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.cancel(id, input.reason, actor, user);
  }

  // ---- Transfers ----
  @Get('transfers/in-transit') @RequireModule('transfers') @RequirePermission('stock.view') inTransit(@ReqUser() user: AuthUser) {
    return this.documents.inTransit(user);
  }
  @Post('transfers/:id/receive') @RequireModule('transfers') @RequirePermission('stock.move') receive(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(receiveTransferSchema)) input: ReceiveTransferInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.receive(id, input, actor, user);
  }

  // ---- Counts ----
  @Post('counts') @RequirePermission('stock.count') createCount(@Body(new ZodValidationPipe(createCountSchema)) input: CreateCountInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.createCount(input, actor, user);
  }
  @Patch('counts/:id') @RequirePermission('stock.count') updateCount(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCountSchema)) input: UpdateCountInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.documents.updateCount(id, input, actor, user);
  }

  // ---- Reports ----
  @Get('balance') @RequirePermission('stock.view') balance(@Query(new ZodValidationPipe(stockBalanceQuerySchema)) q: StockBalanceQuery, @ReqUser() user: AuthUser) {
    return this.reports.balance(q, user);
  }
  /** Plan 11 C3: a style's stock as a size × colour grid per shop. */
  @Get('style-grid') @RequireModule('variants') @RequirePermission('stock.view') styleGrid(@Query('itemId', ParseUUIDPipe) itemId: string, @ReqUser() user: AuthUser, @Query('storeId', new ParseUUIDPipe({ optional: true })) storeId?: string) {
    return this.reports.styleGrid(itemId, storeId, user);
  }
  @Get('ledger') @RequirePermission('stock.view') ledger(@Query(new ZodValidationPipe(stockLedgerQuerySchema)) q: StockLedgerQuery, @ReqUser() user: AuthUser) {
    return this.reports.ledger(q, user);
  }
  @Get('lookup/:code') @RequirePermission('stock.view') lookup(@Param('code') code: string, @ReqUser() user: AuthUser) {
    return this.reports.lookup(code, user);
  }
  @Get('batches') @RequireModule('batches') @RequirePermission('stock.view') batches(@ReqUser() user: AuthUser, @Query('itemId') itemId?: string, @Query('expiringWithinDays') days?: string) {
    return this.reports.batches(itemId || undefined, days ? Number(days) : undefined, user);
  }
  @Get('exceptions/negative') @RequirePermission('stock.view') negative(@ReqUser() user: AuthUser) {
    return this.reports.negativeExceptions(user);
  }
  @Get('consistency') @RequirePermission('stock.lock') consistency() {
    return this.reports.consistencyProblems();
  }

  // ---- Reorder levels and settings ----
  @Get('reorder-levels') @RequirePermission('stock.view') reorder(@ReqUser() user: AuthUser, @Query('storeId') storeId?: string) {
    return this.masters.listReorder(storeId || undefined, user);
  }
  @Post('reorder-levels') @RequirePermission('stock.locations.manage') setReorder(@Body(new ZodValidationPipe(reorderLevelSchema)) input: ReorderLevelInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.masters.setReorder(input, actor, user);
  }
  @Get('settings') @RequirePermission('stock.view') settings() {
    return this.masters.getSettings();
  }
  @Patch('settings') @RequirePermission('stock.lock') updateSettings(@Body(new ZodValidationPipe(updateInventorySettingsSchema)) input: UpdateInventorySettingsInput, @ReqActor() actor: Actor) {
    return this.masters.updateSettings(input, actor);
  }
}
