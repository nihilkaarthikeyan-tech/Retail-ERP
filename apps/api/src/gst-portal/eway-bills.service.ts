// Copyright (c) 2026, Rademics. All rights reserved.
// E-way bills as portal files (plan 08 §4; decision 58; scenario 8.10).
// Goods moving above the limit (other state: the general limit; same state: the
// state's own limit if set) need an e-way bill. From a till bill (home delivery or
// business invoice) or a transfer between stores, a draft takes the distance and
// the transporter or vehicle; drafts are exported as the e-way bill portal's bulk
// JSON; the number the portal gives is entered or imported, with its validity
// (one day per 200 km or part, ending at midnight). Cancelling is allowed within
// 24 hours. The register lists drafts, made, expiring, expired and cancelled.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  buildEWayBill,
  businessDate,
  type CurrentUser,
  Decimal,
  EWAY_CANCEL_HOURS,
  eWayBulkFile,
  type EWayCancelInput,
  eWayDocumentProblems,
  type EWayDraftInput,
  type EWayExportInput,
  type EWayGeneratedInput,
  eWayLimitFor,
  type EWayQuery,
  eWayRequired,
  eWaySourceProblems,
  type EWayUpdateInput,
  eWayValidityDays,
  eWayValidUntil,
  parseEWayResults,
  PORTAL_UPLOAD_MAX_BYTES,
} from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { allowedStoreIds, canAccessStore } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { EWayBill, Prisma } from '../generated/prisma/client.js';
import { ensureGstSettings } from '../gst/gst-core.service.js';
import { TransferGstService } from '../inventory/transfer-gst.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { istDateTime } from './einvoices.service.js';
import { type EWayDocument, eWayDocumentOf, isoDay } from './portal-sources.js';

/** "About to expire": inside the window in which the transporter may extend it (8 hours, official FAQ). */
const EXPIRING_HOURS = 8;

@Injectable()
export class EWayBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly transferGst: TransferGstService,
  ) {}

  private async limits() {
    const company = await this.company.current();
    const s = await ensureGstSettings(this.prisma, company.id);
    return { companyId: company.id, settings: s, limit: s.eWayLimit.toString(), stateLimits: (s.eWayStateLimits ?? {}) as Record<string, string | null> };
  }

  private assertStore(user: CurrentUser, doc: EWayDocument) {
    if (!canAccessStore(user, doc.storeId)) throw new ForbiddenException('You are not allowed to work in this store');
  }

  /** Generated ones whose validity has run out become "expired". */
  private async markExpired(companyId: string) {
    await this.prisma.eWayBill.updateMany({ where: { companyId, status: 'generated', validUntil: { lt: new Date() } }, data: { status: 'expired' } });
  }

  // ---- What needs one ----

  /**
   * Documents of the last 180 days without an e-way bill that need one (value above the
   * limit): finalised transfers between stores, and till bills with a home delivery or
   * a business invoice. Others may still get one by choice.
   */
  async candidates(user: CurrentUser) {
    const { companyId, limit, stateLimits } = await this.limits();
    const since = new Date(Date.parse(`${businessDate()}T00:00:00Z`) - 180 * 86_400_000);
    const own = allowedStoreIds(user);
    const transfers = await this.prisma.stockDocument.findMany({ where: { companyId, kind: 'transfer_send', status: 'finalised', postingDate: { gte: since }, ...(own ? { storeId: { in: own } } : {}) }, select: { id: true } });
    const deliveries = await this.prisma.posDelivery.findMany({ where: { companyId, status: { not: 'cancelled' }, createdAt: { gte: since }, ...(own ? { storeId: { in: own } } : {}) }, select: { billId: true } });
    const business = await this.prisma.posBill.findMany({ where: { companyId, kind: 'sale', status: 'completed', invoiceKind: 'business', businessDate: { gte: since }, ...(own ? { till: { storeId: { in: own } } } : {}) }, select: { id: true } });
    const have = new Set((await this.prisma.eWayBill.findMany({ where: { companyId, status: { not: 'cancelled' } }, select: { documentId: true } })).map((e) => e.documentId));
    const docs: EWayDocument[] = [];
    for (const t of transfers) if (!have.has(t.id)) docs.push(await eWayDocumentOf(this.prisma, 'stock_document', t.id, this.transferGst));
    for (const id of new Set([...deliveries.map((d) => d.billId), ...business.map((b) => b.id)])) if (!have.has(id)) docs.push(await eWayDocumentOf(this.prisma, 'pos_bill', id));
    return docs
      .filter((d) => !d.cancelled && eWayRequired(d.value, { fromState: d.fromState, toState: d.toState, limit, stateLimits }))
      .map((d) => ({ documentType: d.documentType, documentId: d.documentId, number: d.number, date: d.date, value: d.value.toFixed(2), fromState: d.fromState, toState: d.toState, limit: eWayLimitFor({ fromState: d.fromState, toState: d.toState, limit, stateLimits }).toFixed(2) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // ---- Drafts ----

  async createDraft(input: EWayDraftInput, actor: Actor, user: CurrentUser) {
    const { companyId, settings, limit, stateLimits } = await this.limits();
    const doc = await eWayDocumentOf(this.prisma, input.documentType, input.documentId, this.transferGst);
    this.assertStore(user, doc);
    if (doc.cancelled) throw new BadRequestException('The document is cancelled');
    const problems = eWayDocumentProblems({ documentDate: doc.date, today: businessDate(), lineCount: doc.lineCount, goodsLineCount: doc.goodsLineCount, distanceKm: input.distanceKm });
    if (problems.length) throw new BadRequestException(problems.join('. '));
    const data = {
      value: doc.value.toFixed(2),
      distanceKm: input.distanceKm,
      transporterId: input.transporterId || settings.defaultTransporterId || null,
      transporterName: input.transporterName || settings.defaultTransporterName || null,
      vehicleNo: input.vehicleNo || null,
    };
    const required = eWayRequired(doc.value, { fromState: doc.fromState, toState: doc.toState, limit, stateLimits });
    const id = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.eWayBill.findUnique({ where: { documentType_documentId: { documentType: doc.documentType, documentId: doc.documentId } } });
      let row: EWayBill;
      if (existing) {
        // One e-way bill per document; a cancelled one may be made again (official API notes).
        if (existing.status !== 'cancelled') throw new BadRequestException(`This document already has an e-way bill (${existing.status})`);
        row = await tx.eWayBill.update({ where: { id: existing.id }, data: { ...data, status: 'draft', number: null, generatedAt: null, validUntil: null, error: null, updatedById: actor.userId } });
      } else {
        row = await tx.eWayBill.create({ data: { companyId, documentType: doc.documentType, documentId: doc.documentId, documentNumber: doc.number, ...data, createdById: actor.userId, updatedById: actor.userId } });
      }
      await this.audit.record(tx, actor, { action: 'create', entityType: 'e_way_bill', entityId: row.id, changes: { document: doc.number, value: data.value, distanceKm: data.distanceKm, vehicleNo: data.vehicleNo, transporterId: data.transporterId, required } });
      return row.id;
    });
    return this.one(id, user);
  }

  async update(id: string, input: EWayUpdateInput, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    if (row.status !== 'draft') throw new BadRequestException('Only a draft can be changed');
    const data: Prisma.EWayBillUpdateInput = {
      ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
      ...(input.transporterId !== undefined ? { transporterId: input.transporterId || null } : {}),
      ...(input.transporterName !== undefined ? { transporterName: input.transporterName || null } : {}),
      ...(input.vehicleNo !== undefined ? { vehicleNo: input.vehicleNo || null } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.eWayBill.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'e_way_bill', id, row, after);
    });
    return this.one(id, user);
  }

  // ---- Export: the portal's bulk JSON ----

  async exportFile(input: EWayExportInput, actor: Actor, user: CurrentUser) {
    const { companyId } = await this.limits();
    const rows = await this.prisma.eWayBill.findMany({ where: { companyId, id: { in: input.ids } }, orderBy: { createdAt: 'asc' } });
    const bills: Record<string, unknown>[] = [];
    const included: EWayBill[] = [];
    const skipped: { id: string; documentNumber: string; problems: string[] }[] = [];
    for (const r of rows) {
      if (r.status !== 'draft') {
        skipped.push({ id: r.id, documentNumber: r.documentNumber, problems: [`Already ${r.status}`] });
        continue;
      }
      const doc = await eWayDocumentOf(this.prisma, r.documentType, r.documentId, this.transferGst);
      this.assertStore(user, doc);
      const source = { ...doc.source, distanceKm: r.distanceKm ?? 0, transporterId: r.transporterId, transporterName: r.transporterName, vehicleNo: r.vehicleNo };
      const problems = [
        ...eWayDocumentProblems({ documentDate: doc.date, today: businessDate(), lineCount: doc.lineCount, goodsLineCount: doc.goodsLineCount, distanceKm: r.distanceKm }),
        ...eWaySourceProblems(source),
        ...(source.userGstin ? [] : ['The store has no GST registration']),
        ...(doc.number.length > 16 ? ['The document number is longer than the 16 characters the portal takes'] : []),
      ];
      if (problems.length) {
        skipped.push({ id: r.id, documentNumber: r.documentNumber, problems });
        continue;
      }
      bills.push(buildEWayBill(source));
      included.push(r);
    }
    if (!bills.length) return { fileName: null, content: null, count: 0, skipped };
    const content = eWayBulkFile(bills);
    if (Buffer.byteLength(content) > PORTAL_UPLOAD_MAX_BYTES) throw new BadRequestException('The file would be larger than 1 MB; choose fewer e-way bills');
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'e_way_bill', changes: { count: included.length, documents: included.map((r) => r.documentNumber) } });
    return { fileName: `e-way-bills-${businessDate()}.json`, content, count: included.length, skipped };
  }

  // ---- The number from the portal ----

  async markGenerated(id: string, input: EWayGeneratedInput, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    await this.prisma.$transaction(async (tx) => {
      await this.generate(tx, row, input.number, input.generatedAt ? new Date(input.generatedAt) : new Date(), input.validUntil ? new Date(input.validUntil) : null, actor, 'typed in');
    });
    return this.one(id, user);
  }

  private async generate(tx: Prisma.TransactionClient, row: EWayBill, number: string, generatedAt: Date, validUntil: Date | null, actor: Actor, how: string) {
    if (row.status !== 'draft') throw new BadRequestException(`${row.documentNumber}: the e-way bill is already ${row.status}`);
    if (row.distanceKm === null) throw new BadRequestException(`${row.documentNumber}: enter the distance first`);
    const until = validUntil ?? eWayValidUntil(generatedAt, row.distanceKm);
    const clash = await tx.eWayBill.findFirst({ where: { companyId: row.companyId, number, id: { not: row.id } } });
    if (clash) throw new BadRequestException(`E-way bill ${number} is already recorded for ${clash.documentNumber}`);
    const done = await tx.eWayBill.updateMany({ where: { id: row.id, status: 'draft' }, data: { status: 'generated', number, generatedAt, validUntil: until, error: null, updatedById: actor.userId } });
    if (done.count !== 1) throw new BadRequestException('This e-way bill was changed by someone else; open it again');
    await this.audit.record(tx, actor, { action: 'update', entityType: 'e_way_bill', entityId: row.id, changes: { document: row.documentNumber, status: { old: 'draft', new: 'generated' }, number, generatedAt: generatedAt.toISOString(), validUntil: until.toISOString(), validityDays: eWayValidityDays(row.distanceKm), by: how } });
  }

  /** Reads e-way bill numbers from a file saved from the portal, matched by document number. */
  async importResults(file: { buffer: Buffer; originalname?: string } | undefined, actor: Actor, user: CurrentUser) {
    if (!file) throw new BadRequestException('Choose the file saved from the e-way bill portal');
    let results: ReturnType<typeof parseEWayResults>;
    try {
      results = parseEWayResults(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('This is not a JSON or CSV file from the e-way bill portal');
    }
    if (!results.length) throw new BadRequestException('No e-way bill numbers were found in the file');
    const { companyId } = await this.limits();
    const summary = { generated: 0, failed: 0, unchanged: 0, unmatched: [] as string[], problems: [] as string[] };
    await this.prisma.$transaction(async (tx) => {
      for (const res of results) {
        const row = res.documentNumber ? await tx.eWayBill.findFirst({ where: { companyId, documentNumber: { equals: res.documentNumber, mode: 'insensitive' } } }) : null;
        if (!row) {
          summary.unmatched.push(res.documentNumber ?? res.number ?? '(no document number)');
          continue;
        }
        const doc = await eWayDocumentOf(tx, row.documentType, row.documentId, this.transferGst);
        if (!canAccessStore(user, doc.storeId)) {
          summary.problems.push(`${row.documentNumber}: you are not allowed to work in its store`);
          continue;
        }
        if (res.error && !res.number) {
          if (row.status !== 'draft') summary.unchanged += 1;
          else {
            await tx.eWayBill.update({ where: { id: row.id }, data: { error: res.error.slice(0, 1000), updatedById: actor.userId } });
            summary.failed += 1;
          }
          continue;
        }
        if (!res.number || !/^[0-9]{12}$/.test(res.number)) {
          summary.problems.push(`${row.documentNumber}: no 12-digit e-way bill number in the file`);
          continue;
        }
        if (row.status !== 'draft') {
          if (row.number !== res.number) summary.problems.push(`${row.documentNumber}: already ${row.status} as ${row.number ?? 'another number'}`);
          else summary.unchanged += 1;
          continue;
        }
        await this.generate(tx, row, res.number, res.generatedAt ?? new Date(), res.validUntil, actor, `file ${file.originalname ?? ''}`.trim());
        summary.generated += 1;
      }
    });
    return summary;
  }

  /** Cancelling: a draft at any time; a generated one within 24 hours, as on the portal. */
  async cancel(id: string, input: EWayCancelInput, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    if (row.status === 'cancelled') throw new BadRequestException('This e-way bill is already cancelled');
    if (row.status === 'expired') throw new BadRequestException('An expired e-way bill cannot be cancelled');
    if (row.status === 'generated' && (!row.generatedAt || Date.now() - row.generatedAt.getTime() > EWAY_CANCEL_HOURS * 3_600_000)) {
      throw new BadRequestException('More than 24 hours have passed since the e-way bill was made, so the portal no longer allows cancelling it');
    }
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.eWayBill.updateMany({ where: { id, status: row.status }, data: { status: 'cancelled', updatedById: actor.userId } });
      if (done.count !== 1) throw new BadRequestException('This e-way bill was changed by someone else; open it again');
      await this.audit.record(tx, actor, { action: 'update', entityType: 'e_way_bill', entityId: id, changes: { document: row.documentNumber, status: { old: row.status, new: 'cancelled' }, number: row.number }, reason: input.reason });
    });
    return this.one(id, user);
  }

  // ---- Register ----

  async list(q: EWayQuery, user: CurrentUser) {
    const { companyId } = await this.limits();
    await this.markExpired(companyId);
    const soon = new Date(Date.now() + EXPIRING_HOURS * 3_600_000);
    const where: Prisma.EWayBillWhereInput = {
      companyId,
      ...(q.status === 'expiring' ? { status: 'generated', validUntil: { lte: soon } } : q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ documentNumber: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search } }] } : {}),
    };
    const rows = await this.prisma.eWayBill.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    const dtos = await Promise.all(rows.map((r) => this.dto(r)));
    const own = allowedStoreIds(user);
    const all = dtos.filter((r) => (!own || own.includes(r.storeId)) && (!q.from || r.documentDate >= q.from) && (!q.to || r.documentDate <= q.to));
    const counts = await this.prisma.eWayBill.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } });
    const expiring = await this.prisma.eWayBill.count({ where: { companyId, status: 'generated', validUntil: { lte: soon } } });
    return { counts: { ...Object.fromEntries(counts.map((c) => [c.status, c._count._all])), expiring }, rows: all };
  }

  private async dto(r: EWayBill) {
    let doc: EWayDocument | null = null;
    try {
      doc = await eWayDocumentOf(this.prisma, r.documentType, r.documentId, this.transferGst);
    } catch {
      doc = null;
    }
    const soon = Date.now() + EXPIRING_HOURS * 3_600_000;
    return {
      id: r.id,
      documentType: r.documentType,
      documentId: r.documentId,
      documentNumber: r.documentNumber,
      documentKind: r.documentType === 'stock_document' ? 'Transfer' : 'Bill',
      documentDate: doc?.date ?? isoDay(r.createdAt)!,
      storeId: doc?.storeId ?? '',
      fromState: doc?.fromState ?? null,
      toState: doc?.toState ?? null,
      to: doc ? [doc.source.to.name, doc.source.to.place].filter(Boolean).join(', ') : null,
      value: new Decimal(r.value.toString()).toFixed(2),
      distanceKm: r.distanceKm,
      validityDays: r.distanceKm !== null ? eWayValidityDays(r.distanceKm) : null,
      transporterId: r.transporterId,
      transporterName: r.transporterName,
      vehicleNo: r.vehicleNo,
      status: r.status,
      number: r.number,
      generatedAt: r.generatedAt,
      validUntil: r.validUntil,
      expiring: r.status === 'generated' && !!r.validUntil && r.validUntil.getTime() <= soon,
      canCancel: r.status === 'draft' || (r.status === 'generated' && !!r.generatedAt && Date.now() - r.generatedAt.getTime() <= EWAY_CANCEL_HOURS * 3_600_000),
      error: r.error,
    };
  }

  private async getRow(id: string, user: CurrentUser): Promise<EWayBill> {
    const row = await this.prisma.eWayBill.findUnique({ where: { id } });
    const company = await this.company.current();
    if (!row || row.companyId !== company.id) throw new NotFoundException('E-way bill not found');
    const doc = await eWayDocumentOf(this.prisma, row.documentType, row.documentId, this.transferGst);
    this.assertStore(user, doc);
    return row;
  }

  async one(id: string, user: CurrentUser) {
    return this.dto(await this.getRow(id, user));
  }

  /** The e-way bill check for one document: value, limit and whether one is needed, and the bill if made. */
  async forDocument(documentType: 'pos_bill' | 'stock_document', documentId: string, user: CurrentUser) {
    const { limit, stateLimits } = await this.limits();
    const doc = await eWayDocumentOf(this.prisma, documentType, documentId, this.transferGst);
    this.assertStore(user, doc);
    const row = await this.prisma.eWayBill.findUnique({ where: { documentType_documentId: { documentType, documentId } } });
    const lim = eWayLimitFor({ fromState: doc.fromState, toState: doc.toState, limit, stateLimits });
    return {
      documentType,
      documentId,
      number: doc.number,
      value: doc.value.toFixed(2),
      limit: lim.toFixed(2),
      required: doc.value.gt(lim),
      interState: doc.interState,
      problems: eWayDocumentProblems({ documentDate: doc.date, today: businessDate(), lineCount: doc.lineCount, goodsLineCount: doc.goodsLineCount }),
      eWayBill: row ? await this.dto(row) : null,
    };
  }

  /** Print lines for a document that has a generated e-way bill (number and validity). */
  async printDetails(documentType: string, documentId: string): Promise<[string, string][]> {
    const row = await this.prisma.eWayBill.findUnique({ where: { documentType_documentId: { documentType, documentId } } });
    if (!row || !row.number || (row.status !== 'generated' && row.status !== 'expired')) return [];
    return [
      ['E-way bill', row.number],
      ['E-way bill valid until', istDateTime(row.validUntil)],
    ];
  }
}
