// Copyright (c) 2026, Rademics. All rights reserved.
// Module 8 endpoints for GST on purchases (plan 08 §3): the purchase tax
// register (with its Excel download) and input-credit matching against the
// GST portal's inward statement (GSTR-2B).
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { type InwardStatementQuery, inwardStatementQuerySchema, type PurchaseTaxRegisterQuery, purchaseTaxRegisterQuerySchema } from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { GstInwardService } from './gst-inward.service.js';

/** A large business's monthly statement can run to several megabytes. */
const MAX_STATEMENT = 20 * 1024 * 1024;

@Controller('gst')
export class GstInwardController {
  constructor(private readonly inward: GstInwardService) {}

  @Get('purchase-register') @RequirePermission('gst.input_credit') async register(
    @Query(new ZodValidationPipe(purchaseTaxRegisterQuerySchema)) q: PurchaseTaxRegisterQuery,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (q.format === 'xlsx' || q.format === 'csv') {
      const file = await this.inward.registerFile(q, q.format, actor, user);
      res.setHeader('Content-Type', file.contentType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.data);
      return;
    }
    return this.inward.register(q, user);
  }

  @Get('inward-statements') @RequirePermission('gst.input_credit') statements(@Query(new ZodValidationPipe(inwardStatementQuerySchema)) q: InwardStatementQuery) {
    return this.inward.uploads(q.gstRegistrationId);
  }

  @Post('inward-statements') @HttpCode(201) @RequirePermission('gst.input_credit') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT } })) upload(
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @ReqActor() actor: Actor,
  ) {
    return this.inward.upload(file, actor);
  }

  @Get('inward-statements/:id/match') @RequirePermission('gst.input_credit') match(@Param('id', new ParseUUIDPipe()) id: string, @ReqUser() user: AuthUser) {
    return this.inward.match(id, user);
  }
}
