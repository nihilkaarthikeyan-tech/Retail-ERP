// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateAttributeInput,
  createAttributeSchema,
  type CreateBrandInput,
  createBrandSchema,
  type CreateHsnCodeInput,
  createHsnCodeSchema,
  type CreateItemGroupInput,
  createItemGroupSchema,
  type CreateUnitConversionInput,
  createUnitConversionSchema,
  type CreateUnitInput,
  createUnitSchema,
  type UpdateAttributeInput,
  updateAttributeSchema,
  type UpdateBrandInput,
  updateBrandSchema,
  type UpdateCatalogueSettingsInput,
  updateCatalogueSettingsSchema,
  type UpdateHsnCodeInput,
  updateHsnCodeSchema,
  type UpdateItemGroupInput,
  updateItemGroupSchema,
  type UpdateUnitInput,
  updateUnitSchema,
} from 'shared';
import { OwnerAdminOnly, RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CatalogueSettingsService } from './catalogue-settings.service.js';
import { MastersService } from './masters.service.js';
import { UnitsService } from './units.service.js';
import { RequireModule } from '../modules/require-module.js';

const VIEW = 'catalogue.view' as const;
const MANAGE = 'catalogue.manage' as const;

@Controller('catalogue')
export class CatalogueController {
  constructor(
    private readonly units: UnitsService,
    private readonly masters: MastersService,
    private readonly settings: CatalogueSettingsService,
  ) {}

  // ---- Units ----
  @Get('units') @RequirePermission(VIEW) listUnits() {
    return this.units.list();
  }
  @Post('units') @RequirePermission(MANAGE) createUnit(@Body(new ZodValidationPipe(createUnitSchema)) input: CreateUnitInput, @ReqActor() actor: Actor) {
    return this.units.create(input, actor);
  }
  @Patch('units/:id') @RequirePermission(MANAGE) updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) input: UpdateUnitInput,
    @ReqActor() actor: Actor,
  ) {
    return this.units.update(id, input, actor);
  }
  @Get('unit-conversions') @RequirePermission(VIEW) listConversions() {
    return this.units.listConversions();
  }
  @Post('unit-conversions') @RequirePermission(MANAGE) createConversion(
    @Body(new ZodValidationPipe(createUnitConversionSchema)) input: CreateUnitConversionInput,
    @ReqActor() actor: Actor,
  ) {
    return this.units.createConversion(input, actor);
  }

  // ---- Item groups ----
  @Get('item-groups') @RequirePermission(VIEW) groupTree() {
    return this.masters.groupTree();
  }
  @Post('item-groups') @RequirePermission(MANAGE) createGroup(
    @Body(new ZodValidationPipe(createItemGroupSchema)) input: CreateItemGroupInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.createGroup(input, actor);
  }
  @Patch('item-groups/:id') @RequirePermission(MANAGE) updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateItemGroupSchema)) input: UpdateItemGroupInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.updateGroup(id, input, actor);
  }

  // ---- Brands ----
  @Get('brands') @RequirePermission(VIEW) listBrands() {
    return this.masters.listBrands();
  }
  @Post('brands') @RequirePermission(MANAGE) createBrand(@Body(new ZodValidationPipe(createBrandSchema)) input: CreateBrandInput, @ReqActor() actor: Actor) {
    return this.masters.createBrand(input, actor);
  }
  @Patch('brands/:id') @RequirePermission(MANAGE) updateBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBrandSchema)) input: UpdateBrandInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.updateBrand(id, input, actor);
  }

  // ---- HSN codes ----
  @Get('hsn-codes') @RequirePermission(VIEW) listHsn(@Query('search') search?: string) {
    return this.masters.listHsnCodes(search?.trim() || undefined);
  }
  @Post('hsn-codes') @RequirePermission(MANAGE) createHsn(@Body(new ZodValidationPipe(createHsnCodeSchema)) input: CreateHsnCodeInput, @ReqActor() actor: Actor) {
    return this.masters.createHsnCode(input, actor);
  }
  @Patch('hsn-codes/:id') @RequirePermission(MANAGE) updateHsn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHsnCodeSchema)) input: UpdateHsnCodeInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.updateHsnCode(id, input, actor);
  }

  // ---- Variant attributes ----
  @Get('attributes') @RequireModule('variants') @RequirePermission(VIEW) listAttributes() {
    return this.masters.listAttributes();
  }
  @Post('attributes') @RequireModule('variants') @RequirePermission(MANAGE) createAttribute(
    @Body(new ZodValidationPipe(createAttributeSchema)) input: CreateAttributeInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.createAttribute(input, actor);
  }
  @Patch('attributes/:id') @RequireModule('variants') @RequirePermission(MANAGE) updateAttribute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAttributeSchema)) input: UpdateAttributeInput,
    @ReqActor() actor: Actor,
  ) {
    return this.masters.updateAttribute(id, input, actor);
  }

  // ---- Settings ----
  @Get('settings') @RequirePermission(VIEW) getSettings() {
    return this.settings.get();
  }
  @Patch('settings') @OwnerAdminOnly() updateSettings(
    @Body(new ZodValidationPipe(updateCatalogueSettingsSchema)) input: UpdateCatalogueSettingsInput,
    @ReqActor() actor: Actor,
  ) {
    return this.settings.update(input, actor);
  }
}
