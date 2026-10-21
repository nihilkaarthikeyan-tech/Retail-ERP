// Copyright (c) 2026, Rademics. All rights reserved.
// GST settings and the CA's approval (plan 08 §5, scenario 8.11). Entering
// settings uses the GST rate list right; approving uses the approval right.
import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { type GstApprovalInput, gstApprovalSchema, type GstSettingsInput, gstSettingsSchema, type ReasonInput, reasonSchema } from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { GstCoreService } from './gst-core.service.js';

const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller('gst')
export class GstCoreController {
  constructor(private readonly gst: GstCoreService) {}

  @Get('settings') @RequireAnyPermission('gst_rates.manage', 'gst_rates.approve', 'pos.setup', 'pos.sell', 'pos.reports') settings() {
    return this.gst.getSettings();
  }

  @Patch('settings') @RequirePermission('gst_rates.manage') update(@Body(zod(gstSettingsSchema)) input: GstSettingsInput, @ReqActor() actor: Actor) {
    return this.gst.updateSettings(input, actor);
  }

  @Post('settings/approve') @HttpCode(200) @RequirePermission('gst_rates.approve') approve(@Body(zod(gstApprovalSchema)) input: GstApprovalInput, @ReqActor() actor: Actor) {
    return this.gst.approve(input, actor);
  }

  @Post('settings/withdraw-approval') @HttpCode(200) @RequirePermission('gst_rates.approve') withdraw(@Body(zod(reasonSchema)) input: ReasonInput, @ReqActor() actor: Actor) {
    return this.gst.withdrawApproval(input.reason, actor);
  }
}
