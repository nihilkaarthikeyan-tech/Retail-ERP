// Copyright (c) 2026, Rademics. All rights reserved.
// GST settings (plan 08 §5). Entering settings uses the GST rate list right;
// since the owner's decision of 22 Oct 2026 they apply as soon as they are saved.
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type GstSettingsInput, gstSettingsSchema } from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, ReqActor } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { GstCoreService } from './gst-core.service.js';

const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller('gst')
export class GstCoreController {
  constructor(private readonly gst: GstCoreService) {}

  @Get('settings') @RequireAnyPermission('gst_rates.manage', 'pos.setup', 'pos.sell', 'pos.reports') settings() {
    return this.gst.getSettings();
  }

  @Patch('settings') @RequirePermission('gst_rates.manage') update(@Body(zod(gstSettingsSchema)) input: GstSettingsInput, @ReqActor() actor: Actor) {
    return this.gst.updateSettings(input, actor);
  }
}
