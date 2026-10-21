// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoice and e-way bill files (plan 08 §4). Rights are checked here, store rights
// inside the services (rule 11). Exports come back as JSON with the file's text, so
// the screen can show what was left out and why before saving the file.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type EInvoiceCancelInput,
  eInvoiceCancelSchema,
  type EInvoiceExportInput,
  eInvoiceExportSchema,
  type EInvoiceManualInput,
  eInvoiceManualSchema,
  type EInvoiceQuery,
  eInvoiceQuerySchema,
  EWAY_DOCUMENT_TYPES,
  type EWayCancelInput,
  eWayCancelSchema,
  type EWayDraftInput,
  eWayDraftSchema,
  type EWayExportInput,
  eWayExportSchema,
  type EWayGeneratedInput,
  eWayGeneratedSchema,
  type EWayQuery,
  eWayQuerySchema,
  type EWayUpdateInput,
  eWayUpdateSchema,
} from 'shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { EInvoicesService } from './einvoices.service.js';
import { EWayBillsService } from './eway-bills.service.js';
import { RequireModule } from '../modules/require-module.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);
const documentTypeSchema = z.enum(EWAY_DOCUMENT_TYPES);
/** Answer files are small; the portal's own upload limit is 1 MB. */
const MAX_ANSWER_FILE = 5 * 1024 * 1024;

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Controller('gst')
export class GstPortalController {
  constructor(
    private readonly einvoices: EInvoicesService,
    private readonly eway: EWayBillsService,
  ) {}

  // ---- E-invoices ----
  @Get('e-invoices') @RequireModule('einvoice') @RequirePermission('einvoice.manage') list(@Query(zod(eInvoiceQuerySchema)) q: EInvoiceQuery, @ReqUser() user: AuthUser) {
    return this.einvoices.list(q, user);
  }
  @Get('e-invoices/:id') @RequireModule('einvoice') @RequirePermission('einvoice.manage') one(@Param('id', id()) eid: string, @ReqUser() user: AuthUser) {
    return this.einvoices.one(eid, user);
  }
  @Post('e-invoices/export') @RequireModule('einvoice') @HttpCode(200) @RequirePermission('einvoice.manage') exportFile(@Body(zod(eInvoiceExportSchema)) input: EInvoiceExportInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.einvoices.exportFile(input, actor, user);
  }
  @Post('e-invoices/import') @RequireModule('einvoice') @HttpCode(200) @RequirePermission('einvoice.manage') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANSWER_FILE } })) importFile(@UploadedFile() file: UploadedFileLike | undefined, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.einvoices.importResults(file, actor, user);
  }
  @Post('e-invoices/:id/registration') @RequireModule('einvoice') @HttpCode(200) @RequirePermission('einvoice.manage') manual(@Param('id', id()) eid: string, @Body(zod(eInvoiceManualSchema)) input: EInvoiceManualInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.einvoices.enterManually(eid, input, actor, user);
  }
  @Post('e-invoices/:id/retry') @RequireModule('einvoice') @HttpCode(200) @RequirePermission('einvoice.manage') retry(@Param('id', id()) eid: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.einvoices.retry(eid, actor, user);
  }
  @Post('e-invoices/:id/cancel') @RequireModule('einvoice') @HttpCode(200) @RequirePermission('einvoice.manage') cancel(@Param('id', id()) eid: string, @Body(zod(eInvoiceCancelSchema)) input: EInvoiceCancelInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.einvoices.cancel(eid, input, actor, user);
  }

  // ---- E-way bills ----
  @Get('e-way-bills') @RequireModule('eway') @RequirePermission('eway.manage') ewayList(@Query(zod(eWayQuerySchema)) q: EWayQuery, @ReqUser() user: AuthUser) {
    return this.eway.list(q, user);
  }
  @Get('e-way-bills/needed') @RequireModule('eway') @RequirePermission('eway.manage') needed(@ReqUser() user: AuthUser) {
    return this.eway.candidates(user);
  }
  @Get('e-way-bills/for/:documentType/:documentId') @RequireModule('eway') @RequireAnyPermission('eway.manage', 'stock.view', 'pos.reports') forDocument(
    @Param('documentType', zod(documentTypeSchema)) documentType: 'pos_bill' | 'stock_document',
    @Param('documentId', id()) documentId: string,
    @ReqUser() user: AuthUser,
  ) {
    return this.eway.forDocument(documentType, documentId, user);
  }
  @Get('e-way-bills/:id') @RequireModule('eway') @RequirePermission('eway.manage') ewayOne(@Param('id', id()) wid: string, @ReqUser() user: AuthUser) {
    return this.eway.one(wid, user);
  }
  @Post('e-way-bills') @RequireModule('eway') @RequirePermission('eway.manage') draft(@Body(zod(eWayDraftSchema)) input: EWayDraftInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.createDraft(input, actor, user);
  }
  @Patch('e-way-bills/:id') @RequireModule('eway') @RequirePermission('eway.manage') ewayUpdate(@Param('id', id()) wid: string, @Body(zod(eWayUpdateSchema)) input: EWayUpdateInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.update(wid, input, actor, user);
  }
  @Post('e-way-bills/export') @RequireModule('eway') @HttpCode(200) @RequirePermission('eway.manage') ewayExport(@Body(zod(eWayExportSchema)) input: EWayExportInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.exportFile(input, actor, user);
  }
  @Post('e-way-bills/import') @RequireModule('eway') @HttpCode(200) @RequirePermission('eway.manage') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANSWER_FILE } })) ewayImport(@UploadedFile() file: UploadedFileLike | undefined, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.importResults(file, actor, user);
  }
  @Post('e-way-bills/:id/generated') @RequireModule('eway') @HttpCode(200) @RequirePermission('eway.manage') generated(@Param('id', id()) wid: string, @Body(zod(eWayGeneratedSchema)) input: EWayGeneratedInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.markGenerated(wid, input, actor, user);
  }
  @Post('e-way-bills/:id/cancel') @RequireModule('eway') @HttpCode(200) @RequirePermission('eway.manage') ewayCancel(@Param('id', id()) wid: string, @Body(zod(eWayCancelSchema)) input: EWayCancelInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.eway.cancel(wid, input, actor, user);
  }
}
