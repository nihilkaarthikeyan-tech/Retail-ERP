// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { type ApplyShopTypeInput, applyShopTypeSchema, isModuleKey, type ShopTypeKey, type SwitchModuleInput, switchModuleSchema } from 'shared';
import { OwnerAdminOnly } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ModulesService } from './modules.service.js';

@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  /** Any signed-in user: the menus, screens and the till hide what is off. */
  @Get()
  state() {
    return this.modules.state();
  }

  /** Plan 12 rule 5: only the Owner switches modules. */
  @Post('shop-type')
  @HttpCode(200)
  @OwnerAdminOnly()
  shopType(@Body(new ZodValidationPipe(applyShopTypeSchema)) input: ApplyShopTypeInput, @ReqActor() actor: Actor) {
    return this.modules.chooseShopType(input.type as ShopTypeKey, input.confirm ?? false, actor);
  }

  @Patch(':key')
  @OwnerAdminOnly()
  switch(@Param('key') key: string, @Body(new ZodValidationPipe(switchModuleSchema)) input: SwitchModuleInput, @ReqActor() actor: Actor) {
    if (!isModuleKey(key)) throw new NotFoundException(`There is no module "${key}"`);
    return this.modules.switch(key, input.enabled, input.confirm ?? false, actor);
  }
}
