// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreatePriceInput,
  type CreatePriceListInput,
  createPriceListSchema,
  createPriceSchema,
  type MarkdownInput,
  markdownSchema,
  type PriceLookupInput,
  priceLookupSchema,
  type PriceQuery,
  priceQuerySchema,
  type UpdatePriceInput,
  type UpdatePriceListInput,
  updatePriceListSchema,
  updatePriceSchema,
} from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { MarkdownsService } from './markdowns.service.js';
import { PricingService } from './pricing.service.js';

@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly markdowns: MarkdownsService,
  ) {}

  @Get('price-lists')
  @RequirePermission('prices.view')
  lists(@ReqUser() user: AuthUser) {
    return this.pricing.listPriceLists(user);
  }

  @Post('price-lists')
  @RequirePermission('prices.manage')
  createList(@Body(new ZodValidationPipe(createPriceListSchema)) input: CreatePriceListInput, @ReqActor() actor: Actor) {
    return this.pricing.createPriceList(input, actor);
  }

  @Patch('price-lists/:id')
  @RequirePermission('prices.manage')
  updateList(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePriceListSchema)) input: UpdatePriceListInput, @ReqActor() actor: Actor) {
    return this.pricing.updatePriceList(id, input, actor);
  }

  @Get('prices')
  @RequirePermission('prices.view')
  prices(@Query(new ZodValidationPipe(priceQuerySchema)) q: PriceQuery, @ReqUser() user: AuthUser) {
    return this.pricing.listPrices(q, user);
  }

  @Get('prices/lookup')
  @RequirePermission('prices.view')
  lookup(@Query(new ZodValidationPipe(priceLookupSchema)) q: PriceLookupInput, @ReqUser() user: AuthUser) {
    return this.pricing.lookup(q, user);
  }

  @Post('prices')
  @RequirePermission('prices.manage')
  create(@Body(new ZodValidationPipe(createPriceSchema)) input: CreatePriceInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.pricing.createPrice(input, actor, user);
  }

  @Patch('prices/:id')
  @RequirePermission('prices.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePriceSchema)) input: UpdatePriceInput,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    return this.pricing.updatePrice(id, input, actor, user);
  }

  // ---- Markdowns (plan 11 C5) ----

  @Get('markdowns')
  @RequirePermission('prices.view')
  markdownList(@ReqUser() user: AuthUser) {
    return this.markdowns.list(user);
  }

  @Post('markdowns/preview')
  @HttpCode(200)
  @RequirePermission('prices.manage')
  markdownPreview(@Body(new ZodValidationPipe(markdownSchema)) input: MarkdownInput, @ReqUser() user: AuthUser) {
    return this.markdowns.preview(input, user);
  }

  @Post('markdowns')
  @RequirePermission('prices.manage')
  markdownApply(@Body(new ZodValidationPipe(markdownSchema)) input: MarkdownInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.markdowns.apply(input, actor, user);
  }

  @Get('markdowns/:id')
  @RequirePermission('prices.view')
  markdown(@Param('id', ParseUUIDPipe) id: string, @ReqUser() user: AuthUser) {
    return this.markdowns.get(id, user);
  }
}
