// Copyright (c) 2026, Rademics. All rights reserved.
// Module 8 GST return endpoints (plan 08 §3). Each checks the permission here;
// the GSTIN and store limits are applied in the service (rule 11). Downloads
// for the GST portal are recorded in the history like every other export.
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type GstReturnQuery, gstReturnQuerySchema, gstr1PortalJson, stringifyPortalJson } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { writeXlsxBook } from '../imports/spreadsheet.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GstReturnsService } from './gst-returns.service.js';

const query = new ZodValidationPipe(gstReturnQuerySchema as never);

@Controller('reports/gst')
export class GstReturnsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gst: GstReturnsService,
  ) {}

  @Get('registrations') @RequireAnyPermission('gst.returns', 'gst.input_credit') registrations(@ReqUser() user: AuthUser) {
    return this.gst.registrations(user);
  }

  @Get('sales-register') @RequirePermission('gst.returns') salesRegister(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser) {
    return this.gst.salesRegister(q, user);
  }

  @Get('gstr1') @RequirePermission('gst.returns') gstr1(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser) {
    return this.gst.gstr1(q, user);
  }

  /** GSTR-1 for Excel: one sheet per section, named like the offline tool's worksheets. */
  @Get('gstr1/excel') @RequirePermission('gst.returns') async gstr1Excel(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser, @ReqActor() actor: Actor, @Res() res: Response) {
    const r = await this.gst.gstr1(q, user);
    const data = writeXlsxBook(this.gst.gstr1Sheets(r));
    await this.logExport(actor, 'GSTR-1 (Excel)', r);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1-${r.gstin}-${r.fp}.xlsx"`);
    res.send(data);
  }

  /** GSTR-1 as the JSON the GST portal's offline tool uploads (field names from the GSTN "Save GSTR1 data" v4.1 schema). */
  @Get('gstr1/json') @RequirePermission('gst.returns') async gstr1Json(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser, @ReqActor() actor: Actor, @Res() res: Response) {
    const r = await this.gst.gstr1(q, user);
    const text = stringifyPortalJson(gstr1PortalJson(r, r.stateCode));
    await this.logExport(actor, 'GSTR-1 (portal JSON)', r);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1-${r.gstin}-${r.fp}.json"`);
    res.send(text);
  }

  @Get('gstr3b') @RequirePermission('gst.returns') gstr3b(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser) {
    return this.gst.gstr3b(q, user);
  }

  @Get('notes') @RequirePermission('gst.returns') notes(@Query(query) q: GstReturnQuery, @ReqUser() user: AuthUser) {
    return this.gst.notesRegister(q, user);
  }

  @Get('payable') @RequirePermission('gst.returns') payable(@ReqUser() user: AuthUser) {
    return this.gst.payable(user);
  }

  private async logExport(actor: Actor, report: string, r: { gstin: string; period: string; b2b: unknown[]; b2cl: unknown[]; b2cs: unknown[]; cdnr: unknown[]; cdnur: unknown[] }) {
    const rows = r.b2b.length + r.b2cl.length + r.b2cs.length + r.cdnr.length + r.cdnur.length;
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'report', entityId: null, changes: { report, filters: { gstin: r.gstin, period: r.period }, rows } });
  }
}
