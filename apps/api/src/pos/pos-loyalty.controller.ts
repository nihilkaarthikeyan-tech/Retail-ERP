// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 at the till: a customer's points after picking them, checking a gift
// card, and selling or reloading a card. Each belongs to its optional module
// (refused with a plain message while it is off). The card number travels in
// the request body, never in the address (it is like cash to whoever has it).
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type GiftCardLookupInput, giftCardLookupSchema, type GiftCardSaleInput, giftCardSaleSchema } from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { RequireModule } from '../modules/require-module.js';
import { TILL_TOKEN_HEADER } from './pos-common.service.js';
import { PosGiftCardsService } from './pos-gift-cards.service.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller('pos')
export class PosLoyaltyController {
  constructor(private readonly till: PosGiftCardsService) {}

  @Get('till/:id/loyalty/:customerId') @RequireModule('loyalty') @RequirePermission('pos.sell') points(@Param('id', id()) tillId: string, @Param('customerId', id()) customerId: string, @ReqUser() user: AuthUser) {
    return this.till.customerPoints(tillId, customerId, user);
  }

  @Post('till/:id/gift-cards/check') @HttpCode(200) @RequireModule('gift_cards') @RequireAnyPermission('pos.sell', 'giftcards.sell') check(@Param('id', id()) tillId: string, @Body(zod(giftCardLookupSchema)) input: GiftCardLookupInput, @ReqUser() user: AuthUser) {
    return this.till.check(tillId, input.number, user);
  }

  @Post('gift-cards/sell') @RequireModule('gift_cards') @RequirePermission('giftcards.sell') sell(@Body(zod(giftCardSaleSchema)) input: GiftCardSaleInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.till.sell(input, actor, user, token);
  }
}
