// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  type CreateBarcodeInput,
  createBarcodeSchema,
  type CreateItemInput,
  createItemSchema,
  type CreateSeasonInput,
  createSeasonSchema,
  type CreateVariantsInput,
  createVariantsSchema,
  type ItemQuery,
  itemQuerySchema,
  type SetItemUnitsInput,
  setItemUnitsSchema,
  type UpdateBarcodeInput,
  updateBarcodeSchema,
  type UpdateItemInput,
  updateItemSchema,
  type UpdateSeasonInput,
  updateSeasonSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ItemsService } from './items.service.js';
import { SeasonsService } from './seasons.service.js';
import { RequireModule } from '../modules/require-module.js';

const imageSchema = z.object({ mimeType: z.string().max(40), dataBase64: z.string().min(1).max(800_000) });
type ImageInput = z.infer<typeof imageSchema>;

@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly seasons: SeasonsService,
  ) {}

  @Get('catalogue/scan/:code')
  @RequirePermission('catalogue.view')
  scan(@Param('code') code: string, @ReqUser() user: AuthUser) {
    return this.items.scan(code, user);
  }

  @Get('items')
  @RequirePermission('catalogue.view')
  list(@Query(new ZodValidationPipe(itemQuerySchema)) q: ItemQuery, @ReqUser() user: AuthUser) {
    return this.items.list(q, user);
  }

  @Post('items')
  @RequirePermission('catalogue.manage')
  create(@Body(new ZodValidationPipe(createItemSchema)) input: CreateItemInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.items.create(input, actor, user);
  }

  @Get('items/:id')
  @RequirePermission('catalogue.view')
  get(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser) {
    return this.items.get(id, user);
  }

  @Patch('items/:id')
  @RequirePermission('catalogue.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateItemSchema)) input: UpdateItemInput,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    return this.items.update(id, input, actor, user);
  }

  @Put('items/:id/units')
  @RequirePermission('catalogue.manage')
  setUnits(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setItemUnitsSchema)) input: SetItemUnitsInput,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    return this.items.setUnits(id, input, actor, user);
  }

  @Post('items/:id/barcodes')
  @RequirePermission('catalogue.manage')
  addBarcode(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createBarcodeSchema)) input: CreateBarcodeInput, @ReqActor() actor: Actor) {
    return this.items.addBarcode(id, input, actor);
  }

  @Patch('items/:id/barcodes/:barcodeId')
  @RequirePermission('catalogue.manage')
  updateBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @Body(new ZodValidationPipe(updateBarcodeSchema)) input: UpdateBarcodeInput,
    @ReqActor() actor: Actor,
  ) {
    return this.items.updateBarcode(id, barcodeId, input, actor);
  }

  /** Plan 11 B2: copies the style's MRP, HSN, brand, group, maximum discount, description and season to all its variants. */
  @Post('items/:id/apply-to-variants')
  @RequireModule('variants')
  @HttpCode(200)
  @RequirePermission('catalogue.manage')
  applyToVariants(@Param('id', ParseUUIDPipe) id: string, @ReqActor() actor: Actor) {
    return this.items.applyToVariants(id, actor);
  }

  @Get('items/:id/variants')
  @RequireModule('variants')
  @RequirePermission('catalogue.view')
  variants(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser) {
    return this.items.listVariants(id, user);
  }

  @Post('items/:id/variants')
  @RequireModule('variants')
  @RequirePermission('catalogue.manage')
  createVariants(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createVariantsSchema)) input: CreateVariantsInput,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    return this.items.createVariants(id, input, actor, user);
  }

  // ---- Seasons (plan 11 C4) ----

  @Get('seasons')
  @RequireModule('seasons')
  @RequirePermission('catalogue.view')
  listSeasons() {
    return this.seasons.list();
  }

  @Post('seasons')
  @RequireModule('seasons')
  @RequirePermission('catalogue.manage')
  createSeason(@Body(new ZodValidationPipe(createSeasonSchema)) input: CreateSeasonInput, @ReqActor() actor: Actor) {
    return this.seasons.create(input, actor);
  }

  @Patch('seasons/:id')
  @RequireModule('seasons')
  @RequirePermission('catalogue.manage')
  updateSeason(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSeasonSchema)) input: UpdateSeasonInput, @ReqActor() actor: Actor) {
    return this.seasons.update(id, input, actor);
  }

  @Get('items/:id/image')
  @RequirePermission('catalogue.view')
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { mimeType, bytes } = await this.items.getImage(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(Buffer.from(bytes));
  }

  @Put('items/:id/image')
  @RequirePermission('catalogue.manage')
  @HttpCode(204)
  async setImage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(imageSchema)) input: ImageInput, @ReqActor() actor: Actor) {
    await this.items.setImage(id, input.mimeType, input.dataBase64, actor);
  }

  @Delete('items/:id/image')
  @RequirePermission('catalogue.manage')
  @HttpCode(204)
  async deleteImage(@Param('id', ParseUUIDPipe) id: string, @ReqActor() actor: Actor) {
    await this.items.deleteImage(id, actor);
  }
}
