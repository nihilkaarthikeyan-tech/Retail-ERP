// Copyright (c) 2026, Rademics. All rights reserved.
// Module 10 endpoints (plan 10 §6): printing, labels, import and export, going live.
import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  type ClearTrialDataInput,
  clearTrialDataSchema,
  EXPORT_KINDS,
  type ExportKind,
  type GoLiveDateInput,
  goLiveDateSchema,
  type ImportOptions,
  importOptionsSchema,
  type LabelRequest,
  labelRequestSchema,
  type LabelTemplateInput,
  labelTemplateSchema,
  PRINT_KINDS,
  type PrintKind,
  type PrintSettingsInput,
  printSettingsSchema,
  type StandardTermsInput,
  standardTermsSchema,
} from 'shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ImportsService } from '../imports/imports.service.js';
import { GoLiveService } from './go-live.service.js';
import { LabelsService } from './labels.service.js';
import { PrintService } from './print.service.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);
interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}
const MAX_UPLOAD = 15 * 1024 * 1024;

function sendFile(res: Response, file: { fileName: string; data: Buffer; contentType?: string }) {
  res.setHeader('Content-Type', file.contentType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.data);
}

@Controller()
export class DocumentsController {
  constructor(
    private readonly print: PrintService,
    private readonly labelsService: LabelsService,
    private readonly goLive: GoLiveService,
    private readonly imports: ImportsService,
  ) {}

  // ---- Printing ----
  @Get('print/settings') @RequireAnyPermission('print.settings', 'purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit') printSettings() {
    return this.print.settings();
  }
  @Put('print/settings') @RequirePermission('print.settings') savePrintSettings(@Body(zod(printSettingsSchema)) input: PrintSettingsInput, @ReqActor() actor: Actor) {
    return this.print.saveSettings(input, actor);
  }
  /** The logo for printed letterheads (an image the browser loads; logged-in users only). */
  @Get('print/logo') @RequireAnyPermission('print.settings', 'purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit', 'labels.print') async printLogo(@Res() res: Response) {
    const logo = await this.print.logo();
    if (!logo) {
      res.status(404).send();
      return;
    }
    res.setHeader('Content-Type', logo.type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(logo.data);
  }
  @Post('print/logo') @HttpCode(200) @RequirePermission('print.settings') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 400_000 } })) saveLogo(@UploadedFile() file: UploadedFileLike | undefined, @ReqActor() actor: Actor) {
    return this.print.saveLogo(file, actor);
  }
  @Get('print/terms') @RequireAnyPermission('print.settings', 'purchase.view', 'accounts.view') terms() {
    return this.print.terms();
  }
  @Post('print/terms') @RequirePermission('print.settings') createTerms(@Body(zod(standardTermsSchema)) input: StandardTermsInput, @ReqActor() actor: Actor) {
    return this.print.saveTerms(null, input, actor);
  }
  @Patch('print/terms/:id') @RequirePermission('print.settings') updateTerms(@Param('id', id()) termsId: string, @Body(zod(standardTermsSchema)) input: StandardTermsInput, @ReqActor() actor: Actor) {
    return this.print.saveTerms(termsId, input, actor);
  }
  /** A document's print data; the statement id is "customer:<id>" or "supplier:<id>". Every print is logged. */
  @Get('print/:kind/:id') @RequireAnyPermission('purchase.view', 'stock.view', 'accounts.view', 'payments.post', 'journals.post', 'cash.deposit') document(
    @Param('kind', zod(z.enum(PRINT_KINDS))) kind: PrintKind,
    @Param('id', zod(z.string().regex(/^((customer|supplier):)?[0-9a-f-]{36}$/i, 'Not a document id'))) docId: string,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    return this.print.document(kind, docId, actor, user);
  }

  // ---- Labels ----
  @Get('labels/templates') @RequireAnyPermission('labels.print', 'print.settings') labelTemplates() {
    return this.labelsService.templates();
  }
  @Post('labels/templates') @RequirePermission('print.settings') createLabelTemplate(@Body(zod(labelTemplateSchema)) input: LabelTemplateInput, @ReqActor() actor: Actor) {
    return this.labelsService.saveTemplate(null, input, actor);
  }
  @Patch('labels/templates/:id') @RequirePermission('print.settings') updateLabelTemplate(@Param('id', id()) templateId: string, @Body(zod(labelTemplateSchema)) input: LabelTemplateInput, @ReqActor() actor: Actor) {
    return this.labelsService.saveTemplate(templateId, input, actor);
  }
  @Post('labels/data') @HttpCode(200) @RequirePermission('labels.print') labels(@Body(zod(labelRequestSchema)) input: LabelRequest, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.labelsService.labels(input, actor, user);
  }

  // ---- Import (decisions 77, 78: file upload only) ----
  @Get('imports/kinds') @RequireAnyPermission('import.masters', 'import.opening') importKinds(@ReqUser() user: AuthUser) {
    return this.imports.kindsFor(user);
  }
  @Get('imports/templates/:kind') @RequireAnyPermission('import.masters', 'import.opening') template(@Param('kind') kind: string, @ReqUser() user: AuthUser, @Res() res: Response) {
    sendFile(res, this.imports.template(kind, user));
  }
  @Post('imports/preview') @HttpCode(200) @RequireAnyPermission('import.masters', 'import.opening') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } })) preview(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('options', zod(z.string().transform((s, ctx) => {
      try {
        return importOptionsSchema.parse(JSON.parse(s));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'The import options are not valid' });
        return z.NEVER;
      }
    }))) options: ImportOptions,
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Choose a file to import');
    return this.imports.preview(file.originalname, file.buffer, options, actor, user);
  }
  @Post('imports/:id/run') @HttpCode(200) @RequireAnyPermission('import.masters', 'import.opening') run(@Param('id', id()) jobId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.imports.run(jobId, actor, user);
  }
  @Get('imports') @RequireAnyPermission('import.masters', 'import.opening') importJobs(@ReqUser() user: AuthUser) {
    return this.imports.list(user);
  }
  @Get('imports/:id') @RequireAnyPermission('import.masters', 'import.opening') importJob(@Param('id', id()) jobId: string, @ReqUser() user: AuthUser) {
    return this.imports.status(jobId, user);
  }
  @Get('imports/:id/failed-rows') @RequireAnyPermission('import.masters', 'import.opening') async failedRows(@Param('id', id()) jobId: string, @ReqUser() user: AuthUser, @Res() res: Response) {
    sendFile(res, await this.imports.failedRows(jobId, user));
  }

  // ---- Export (plan 10 §1.D) ----
  @Get('exports/:kind') @RequirePermission('export.masters') async export(
    @Param('kind', zod(z.enum(EXPORT_KINDS))) kind: ExportKind,
    @Query('format', zod(z.enum(['xlsx', 'csv']).default('xlsx'))) format: 'xlsx' | 'csv',
    @ReqActor() actor: Actor,
    @ReqUser() user: AuthUser,
    @Res() res: Response,
  ) {
    sendFile(res, await this.imports.export(kind, format, actor, user));
  }

  // ---- Going live (decision 72) ----
  @Get('go-live') @RequirePermission('golive.manage') goLiveStatus(@ReqUser() user: AuthUser) {
    return this.goLive.status(user);
  }
  @Post('go-live/clear-trial-data') @HttpCode(200) @RequirePermission('golive.manage') clear(@Body(zod(clearTrialDataSchema)) input: ClearTrialDataInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.goLive.clearTrialData(input, actor, user);
  }
  @Post('go-live/date') @HttpCode(200) @RequirePermission('golive.manage') goLiveDate(@Body(zod(goLiveDateSchema)) input: GoLiveDateInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.goLive.setGoLive(input, actor, user);
  }
}

