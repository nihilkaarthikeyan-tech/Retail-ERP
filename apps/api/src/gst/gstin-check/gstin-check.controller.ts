// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireAnyPermission } from '../../auth/decorators.js';
import { type Actor, ReqActor } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { GstinCheckService } from './gstin-check.service.js';

const checkSchema = z.object({ gstin: z.string().trim().min(1).max(20) });

/** Plan 15: "Check with GST network" on the customer and supplier forms. */
@Controller('gstin')
export class GstinCheckController {
  constructor(private readonly gstin: GstinCheckService) {}

  @Post('check') @HttpCode(200) @RequireAnyPermission('customers.manage', 'suppliers.manage') check(@Body(new ZodValidationPipe(checkSchema)) input: { gstin: string }, @ReqActor() actor: Actor) {
    return this.gstin.check(input.gstin, actor);
  }
}
