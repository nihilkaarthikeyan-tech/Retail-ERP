// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { type LeadInput, leadSchema } from 'shared';
import { Public } from '../auth/decorators.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SystemPrisma } from '../prisma/prisma.service.js';

/**
 * Plan 14: the landing page's "Contact us / book a demo" form. Kept above the
 * shops (no shop sees it); Rademics reads it on the platform admin screen.
 */
@Controller('leads')
export class LeadsController {
  private readonly log = new Logger(LeadsController.name);

  constructor(private readonly system: SystemPrisma) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(@Body(new ZodValidationPipe(leadSchema)) input: LeadInput, @Req() req: Request): Promise<{ ok: true }> {
    // A form-filling robot fills in the hidden field: it is told "thank you" and nothing is kept.
    if (input.website) return { ok: true };
    const { website: _robotField, ...lead } = input;
    await this.system.lead.create({ data: { ...lead, ipAddress: clientIp(req) } });
    this.log.log(`New message from the landing page: ${lead.name}`);
    return { ok: true };
  }
}
