// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNT_ROLE_BY_REASON,
  businessDate,
  type CountLineInput,
  type CreateCountInput,
  type CreateStockDocumentInput,
  type CurrentUser,
  Decimal,
  expiryFromShelfLife,
  hasPermission,
  isExpiredOn,
  type PermissionKey,
  QUANTITY_TOLERANCE,
  quantityProblem,
  type ReceiveTransferInput,
  roundQuantity,
  STOCK_IN_REASONS,
  STOCK_OUT_REASONS,
  type StockDocumentQuery,
  type StockLineInput,
  type UpdateCountInput,
  type UpdateStockDocumentInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess, allowedStoreIds } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { Item, Prisma, StockDocument, StockLedgerEntry, StockLocation } from '../generated/prisma/client.js';
import { ItemsService } from '../items/items.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { seriesKind } from './location-defaults.js';
import { type Movement, StockEngine } from './stock-engine.service.js';

const D = (v: { toString(): string } | string | number) => new Decimal(v.toString());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);

export const documentInclude = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, baseUnitId: true, trackBatches: true, trackSerials: true } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
    },
  },
} satisfies Prisma.StockDocumentInclude;
export type DocumentRow = Prisma.StockDocumentGetPayload<{ include: typeof documentInclude }>;

/** Indian date + "HH:MM" → the instant (rule 15). Defaults: today, now. */
export function postingInstant(date: string, time?: string): Date {
  if (time) return new Date(`${date}T${time}:00+05:30`);
  const today = businessDate();
  if (date === today) return new Date();
  return new Date(`${date}T23:59:00+05:30`); // a past date without a time counts as end of that day
}

interface ResolvedLine {
  lineNo: number;
  item: Item;
  unitId: string;
  quantity: Decimal;
  factor: Decimal;
  basicQuantity: Decimal;
  batchId: string | null;
  newBatchNumber: string | null;
  newManufactureOn: string | null;
  newExpiryOn: string | null;
  serialNumbers: string[];
  unitCost: Decimal | null;
  countedQuantity?: Decimal | null;
}

@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly numbering: NumberingService,
    private readonly years: FinancialYearsService,
    private readonly items: ItemsService,
    private readonly engine: StockEngine,
  ) {}

  // ---- Reading ----

  async list(q: StockDocumentQuery, user: CurrentUser) {
    const company = await this.company.current();
    const ids = allowedStoreIds(user);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.StockDocumentWhereInput = {
      companyId: company.id,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.storeId ? { OR: [{ storeId: q.storeId }, { toStoreId: q.storeId }] } : {}),
      ...(ids ? { AND: [{ OR: [{ storeId: { in: ids } }, { toStoreId: { in: ids } }] }] } : {}),
      ...(q.from || q.to ? { postingDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockDocument.findMany({ where, orderBy: [{ postingAt: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.stockDocument.count({ where }),
    ]);
    const showCost = hasPermission(user, 'stock.cost.view');
    return { rows: rows.map((d) => this.header(d, showCost)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const doc = await this.getRow(this.prisma, id);
    this.assertDocAccess(doc, user);
    return this.toDto(doc, user);
  }

  async getRow(db: Db, id: string): Promise<DocumentRow> {
    const doc = await db.stockDocument.findUnique({ where: { id }, include: documentInclude });
    if (!doc) throw new NotFoundException('Stock document not found');
    return doc;
  }

  // ---- Creating and editing drafts ----

  async create(input: CreateStockDocumentInput, actor: Actor, user: CurrentUser) {
    this.requireDraftRight(input.kind, user);
    assertStoreAccess(user, input.storeId);
    const company = await this.company.current();
    const header = await this.checkHeader(this.prisma, company.id, input.kind, input);
    const lines = await this.resolveLines(this.prisma, input.kind, input.lines, false);
    const postingDate = input.postingDate ?? businessDate();

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: seriesKind(input.kind), storeId: input.storeId, date: postingDate });
      const doc = await tx.stockDocument.create({
        data: {
          companyId: company.id,
          number,
          kind: input.kind,
          reason: input.reason ?? null,
          postingDate: fromIso(postingDate),
          postingAt: postingInstant(postingDate, input.postingTime),
          storeId: input.storeId,
          toStoreId: header.toStoreId,
          fromLocationId: header.fromLocationId,
          toLocationId: header.toLocationId,
          remarks: input.remarks ?? null,
          lines: { create: lines.map(lineData) },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: documentInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'stock_document', entityId: doc.id, changes: { number, kind: doc.kind, reason: doc.reason, lines: lines.length } });
      return doc;
    });
    return this.toDto(created, user);
  }

  async update(id: string, input: UpdateStockDocumentInput, actor: Actor, user: CurrentUser) {
    const before = await this.getRow(this.prisma, id);
    this.assertDocAccess(before, user);
    if (before.status !== 'draft') throw new BadRequestException('Only drafts can be changed; cancel and create a new document instead');
    if (before.kind === 'count' || before.kind === 'transfer_receive') throw new BadRequestException('Use the count or receive screen');
    this.requireDraftRight(before.kind, user);
    const merged = {
      reason: input.reason !== undefined ? input.reason : before.reason,
      storeId: before.storeId,
      fromLocationId: input.fromLocationId !== undefined ? input.fromLocationId : before.fromLocationId,
      toLocationId: input.toLocationId !== undefined ? input.toLocationId : before.toLocationId,
      toStoreId: input.toStoreId !== undefined ? input.toStoreId : before.toStoreId,
    };
    const header = await this.checkHeader(this.prisma, before.companyId, before.kind, merged);
    const lines = input.lines ? await this.resolveLines(this.prisma, before.kind, input.lines, false) : null;
    const postingDate = input.postingDate ?? iso(before.postingDate)!;
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.stockDocument.update({
        where: { id },
        data: {
          reason: merged.reason,
          toStoreId: header.toStoreId,
          fromLocationId: header.fromLocationId,
          toLocationId: header.toLocationId,
          postingDate: fromIso(postingDate),
          postingAt: input.postingDate || input.postingTime ? postingInstant(postingDate, input.postingTime) : undefined,
          remarks: input.remarks !== undefined ? input.remarks : undefined,
          updatedById: actor.userId,
          ...(lines ? { lines: { deleteMany: {}, create: lines.map(lineData) } } : {}),
        },
        include: documentInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'stock_document', id, summarise(before), summarise(after));
      return after;
    });
    return this.toDto(updated, user);
  }

  // ---- Counts ----

  async createCount(input: CreateCountInput, actor: Actor, user: CurrentUser) {
    this.requireRight(user, 'stock.count');
    assertStoreAccess(user, input.storeId);
    const company = await this.company.current();
    const location = await this.assertLocation(this.prisma, company.id, input.locationId, { storeId: input.storeId, allowTransit: false });
    const lines = await this.resolveCountLines(this.prisma, input.lines);
    const postingDate = input.postingDate ?? businessDate();
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: seriesKind('count'), storeId: input.storeId, date: postingDate });
      const doc = await tx.stockDocument.create({
        data: {
          companyId: company.id,
          number,
          kind: 'count',
          countType: input.countType,
          blind: input.blind ?? false,
          postingDate: fromIso(postingDate),
          postingAt: postingInstant(postingDate, input.postingTime),
          storeId: input.storeId,
          toLocationId: location.id,
          remarks: input.remarks ?? null,
          lines: { create: lines.map(lineData) },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: documentInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'stock_document', entityId: doc.id, changes: { number, kind: 'count', countType: input.countType, lines: lines.length } });
      return this.fillExpected(tx, doc);
    });
    return this.toDto(created, user);
  }

  /** Draft counts show what the system expects at the count's time (hidden from counters on a blind count). */
  private async fillExpected(tx: Db, doc: DocumentRow): Promise<DocumentRow> {
    for (const l of doc.lines) {
      const expected = await this.quantityAt(tx, l.itemId, doc.toLocationId!, l.batchId, doc.postingAt);
      await tx.stockDocumentLine.update({ where: { id: l.id }, data: { expectedQuantity: expected.toString() } });
    }
    return this.getRow(tx, doc.id);
  }

  async updateCount(id: string, input: UpdateCountInput, actor: Actor, user: CurrentUser) {
    const before = await this.getRow(this.prisma, id);
    this.assertDocAccess(before, user);
    if (before.kind !== 'count') throw new BadRequestException('Not a stock count');
    if (before.status !== 'draft') throw new BadRequestException('Only drafts can be changed');
    this.requireRight(user, 'stock.count');
    const location = input.locationId ? await this.assertLocation(this.prisma, before.companyId, input.locationId, { storeId: before.storeId, allowTransit: false }) : null;
    const lines = input.lines ? await this.resolveCountLines(this.prisma, input.lines) : null;
    const postingDate = input.postingDate ?? iso(before.postingDate)!;
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.stockDocument.update({
        where: { id },
        data: {
          toLocationId: location?.id,
          blind: input.blind,
          postingDate: fromIso(postingDate),
          postingAt: input.postingDate || input.postingTime ? postingInstant(postingDate, input.postingTime) : undefined,
          remarks: input.remarks !== undefined ? input.remarks : undefined,
          updatedById: actor.userId,
          ...(lines ? { lines: { deleteMany: {}, create: lines.map(lineData) } } : {}),
        },
        include: documentInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'stock_document', id, summarise(before), summarise(after));
      return this.fillExpected(tx, after);
    });
    return this.toDto(updated, user);
  }

  // ---- Finalising ----

  async finalise(id: string, actor: Actor, user: CurrentUser) {
    const doc = await this.getRow(this.prisma, id);
    this.assertDocAccess(doc, user);
    if (doc.status !== 'draft') throw new BadRequestException(`Document is already ${doc.status}`);
    this.requireFinaliseRight(doc.kind, user);
    await this.checkDates(this.prisma, doc, user);

    const finalised = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await this.getRow(tx, id);
        if (fresh.status !== 'draft') throw new BadRequestException(`Document is already ${fresh.status}`);
        await this.checkBackdating(tx, fresh, user);
        const describe = await this.describer(tx, fresh);
        let entries: StockLedgerEntry[];
        if (fresh.kind === 'count') {
          entries = await this.finaliseCount(tx, fresh, actor, describe);
        } else {
          await this.prepareBatches(tx, fresh, actor);
          const movements = await this.movementsFor(tx, fresh);
          entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe });
          await this.applySerials(tx, fresh, 'finalise', actor);
        }
        await this.storeLineValues(tx, fresh, entries);
        const after = await tx.stockDocument.update({
          where: { id },
          data: { status: 'finalised', finalisedAt: new Date(), finalisedById: actor.userId, ...totals(entries), isBackDated: fresh.isBackDated, updatedById: actor.userId },
          include: documentInclude,
        });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'stock_document',
          entityId: id,
          changes: { status: { old: 'draft', new: 'finalised' }, number: after.number, valueIn: after.totalValueIn.toString(), valueOut: after.totalValueOut.toString() },
        });
        return after;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(finalised, user);
  }

  // ---- Transfers: receiving ----

  async inTransit(user: CurrentUser) {
    const company = await this.company.current();
    const ids = allowedStoreIds(user);
    const sends = await this.prisma.stockDocument.findMany({
      where: { companyId: company.id, kind: 'transfer_send', status: 'finalised', ...(ids ? { OR: [{ toStoreId: { in: ids } }, { storeId: { in: ids } }] } : {}) },
      include: documentInclude,
      orderBy: { postingAt: 'asc' },
    });
    return sends
      .filter((s) => s.lines.some((l) => D(l.receivedQuantity).lt(D(l.basicQuantity))))
      .map((s) => this.toDto(s, user));
  }

  async receive(sendId: string, input: ReceiveTransferInput, actor: Actor, user: CurrentUser) {
    this.requireRight(user, 'stock.move');
    const send = await this.getRow(this.prisma, sendId);
    if (send.kind !== 'transfer_send' || send.status !== 'finalised') throw new BadRequestException('Only a finalised transfer can be received');
    if (!send.toStoreId) throw new BadRequestException('Transfer has no receiving store');
    assertStoreAccess(user, send.toStoreId);
    const destination = input.toLocationId
      ? await this.assertLocation(this.prisma, send.companyId, input.toLocationId, { storeId: send.toStoreId, allowTransit: false })
      : await this.defaultShelf(this.prisma, send.toStoreId);
    const postingDate = input.postingDate ?? businessDate();
    if (postingDate < iso(send.postingDate)!) throw new BadRequestException('Goods cannot be received before they were sent');

    const wanted = input.lines ?? send.lines.map((l) => ({ sendLineId: l.id, quantity: D(l.basicQuantity).sub(D(l.receivedQuantity)).toString(), serialNumbers: undefined }));
    const receiveLines: { send: DocumentRow['lines'][number]; quantity: Decimal; serials: string[] }[] = [];
    for (const w of wanted) {
      const line = send.lines.find((l) => l.id === w.sendLineId);
      if (!line) throw new BadRequestException('Line is not part of this transfer');
      const quantity = roundQuantity(w.quantity);
      if (quantity.lte(0)) continue;
      const open = D(line.basicQuantity).sub(D(line.receivedQuantity));
      if (quantity.gt(open.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${line.item.code}: only ${open.toString()} still in transit`);
      let serials: string[] = [];
      if (line.item.trackSerials) {
        serials = w.serialNumbers ?? (quantity.eq(open) ? line.serialNumbers.filter(Boolean) : []);
        const inTransit = await this.prisma.serialNumber.findMany({ where: { itemId: line.itemId, serial: { in: serials }, status: 'in_transit' } });
        if (inTransit.length !== serials.length || !quantity.eq(serials.length)) throw new BadRequestException(`${line.item.code}: list the ${quantity.toString()} serial numbers being received`);
      }
      receiveLines.push({ send: line, quantity, serials });
    }
    if (!receiveLines.length) throw new BadRequestException('Nothing to receive');
    const company = await this.company.current();
    const transitId = await this.transitId(this.prisma, company.id);
    const fakeDoc = { postingDate: fromIso(postingDate), companyId: company.id } as StockDocument;
    await this.checkDates(this.prisma, fakeDoc, user);

    const received = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: seriesKind('transfer_receive'), storeId: send.toStoreId!, date: postingDate });
        const doc = await tx.stockDocument.create({
          data: {
            companyId: company.id,
            number,
            kind: 'transfer_receive',
            status: 'draft',
            postingDate: fromIso(postingDate),
            postingAt: postingInstant(postingDate, input.postingTime),
            storeId: send.toStoreId!,
            fromLocationId: transitId,
            toLocationId: destination.id,
            sendDocumentId: send.id,
            remarks: input.remarks ?? null,
            lines: {
              create: receiveLines.map((r, i) => ({
                lineNo: i + 1,
                itemId: r.send.itemId,
                unitId: r.send.item.baseUnitId,
                quantity: r.quantity.toString(),
                factor: '1',
                basicQuantity: r.quantity.toString(),
                batchId: r.send.batchId,
                serialNumbers: r.serials,
                sendLineId: r.send.id,
              })),
            },
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include: documentInclude,
        });
        await this.checkBackdating(tx, doc, user);
        // Lock the send lines so two people cannot receive the same goods twice.
        for (const r of receiveLines) {
          await tx.$queryRaw`SELECT 1 FROM "StockDocumentLine" WHERE "id" = ${r.send.id}::uuid FOR UPDATE`;
          const current = await tx.stockDocumentLine.findUniqueOrThrow({ where: { id: r.send.id } });
          if (D(current.receivedQuantity).add(r.quantity).gt(D(current.basicQuantity).add(QUANTITY_TOLERANCE))) {
            throw new BadRequestException(`${r.send.item.code}: already received`);
          }
          await tx.stockDocumentLine.update({ where: { id: r.send.id }, data: { receivedQuantity: D(current.receivedQuantity).add(r.quantity).toString() } });
        }
        await this.prepareBatches(tx, doc, actor);
        const movements = await this.movementsFor(tx, doc);
        const entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, doc) });
        await this.applySerials(tx, doc, 'finalise', actor);
        await this.storeLineValues(tx, doc, entries);
        const after = await tx.stockDocument.update({
          where: { id: doc.id },
          data: { status: 'finalised', finalisedAt: new Date(), finalisedById: actor.userId, ...totals(entries), isBackDated: doc.isBackDated },
          include: documentInclude,
        });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'stock_document', entityId: doc.id, changes: { number, kind: 'transfer_receive', from: send.number, status: 'finalised' } });
        return after;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(received, user);
  }

  // ---- Cancelling ----

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    const doc = await this.getRow(this.prisma, id);
    this.assertDocAccess(doc, user);
    if (doc.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (doc.status === 'draft') {
      this.requireDraftRight(doc.kind, user);
      const after = await this.prisma.$transaction(async (tx) => {
        const a = await tx.stockDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason }, include: documentInclude });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'stock_document', entityId: id, changes: { status: { old: 'draft', new: 'cancelled' } }, reason });
        return a;
      });
      return this.toDto(after, user);
    }
    this.requireFinaliseRight(doc.kind, user);
    if (doc.kind === 'transfer_send' && doc.lines.some((l) => D(l.receivedQuantity).gt(0))) {
      throw new BadRequestException('Goods from this transfer were already received; cancel the receipts first');
    }
    await this.checkDates(this.prisma, doc, user);
    // Cancelling re-works later movements from the original date (decision 35 applies).
    if (iso(doc.postingDate)!.slice(0, 7) < businessDate().slice(0, 7) && !hasPermission(user, 'stock.backdate')) {
      throw new ForbiddenException('Only the Accountant may cancel a document from an earlier month');
    }
    const after = await this.prisma.$transaction(
      async (tx) => {
        const lineFor = new Map(doc.lines.map((l) => [l.id, l.id]));
        await this.engine.reverseDocument(tx, id, (e) => lineFor.get(e.documentLineId) ?? e.documentLineId, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, doc) });
        await this.applySerials(tx, doc, 'cancel', actor);
        if (doc.kind === 'transfer_receive') {
          for (const l of doc.lines) {
            if (!l.sendLineId) continue;
            const sendLine = await tx.stockDocumentLine.findUniqueOrThrow({ where: { id: l.sendLineId } });
            await tx.stockDocumentLine.update({ where: { id: l.sendLineId }, data: { receivedQuantity: D(sendLine.receivedQuantity).sub(D(l.basicQuantity)).toString() } });
          }
        }
        const a = await tx.stockDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason }, include: documentInclude });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'stock_document', entityId: id, changes: { status: { old: 'finalised', new: 'cancelled' }, number: doc.number }, reason });
        return a;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(after, user);
  }

  // ---- Movements for each kind ----

  private async movementsFor(tx: Db, doc: DocumentRow): Promise<Movement[]> {
    const base = (l: DocumentRow['lines'][number]) => ({
      companyId: doc.companyId,
      documentId: doc.id,
      documentLineId: l.id,
      itemId: l.itemId,
      batchId: l.batchId,
      postingDate: iso(doc.postingDate)!,
      postingAt: doc.postingAt,
    });
    const out: Movement[] = [];
    switch (doc.kind) {
      case 'stock_in':
        for (const l of doc.lines) {
          out.push({ ...base(l), locationId: doc.toLocationId!, kind: 'in', quantity: l.basicQuantity.toString(), incomingCost: (l.unitCost ?? '0').toString(), accountRole: ACCOUNT_ROLE_BY_REASON[doc.reason ?? 'other_in'] });
        }
        return out;
      case 'stock_out':
        for (const l of doc.lines) {
          out.push({ ...base(l), locationId: doc.fromLocationId!, kind: 'out', quantity: l.basicQuantity.toString(), accountRole: ACCOUNT_ROLE_BY_REASON[doc.reason ?? 'other_out'] });
        }
        return out;
      case 'move':
      case 'transfer_send':
        for (const l of doc.lines) {
          out.push({ ...base(l), locationId: doc.fromLocationId!, kind: 'out', quantity: l.basicQuantity.toString(), accountRole: 'transfer' });
          out.push({ ...base(l), locationId: doc.toLocationId!, kind: 'in', quantity: l.basicQuantity.toString(), costSourceIndex: out.length - 1, accountRole: 'transfer' });
        }
        return out;
      case 'transfer_receive':
        for (const l of doc.lines) {
          // Out of transit at the cost the goods went in at, then into the shelf at that same cost.
          const transitIn = await tx.stockLedgerEntry.findFirst({ where: { documentLineId: l.sendLineId!, kind: 'in', isCancellation: false } });
          if (!transitIn) throw new BadRequestException('The transfer has no stock in transit');
          out.push({ ...base(l), locationId: doc.fromLocationId!, kind: 'out', quantity: l.basicQuantity.toString(), costSourceId: transitIn.id, accountRole: 'transfer' });
          out.push({ ...base(l), locationId: doc.toLocationId!, kind: 'in', quantity: l.basicQuantity.toString(), costSourceIndex: out.length - 1, accountRole: 'transfer' });
        }
        return out;
      case 'count':
        throw new Error('counts are finalised by finaliseCount');
    }
  }

  /** Counts: expected at the count's own time; untracked items set the quantity, tracked ones post the difference. */
  private async finaliseCount(tx: Db, doc: DocumentRow, actor: Actor, describe: (itemId: string, locationId: string) => string): Promise<StockLedgerEntry[]> {
    const locationId = doc.toLocationId!;
    const role = doc.countType === 'opening' ? 'temporary_opening' : 'stock_adjustment';
    const movements: Movement[] = [];
    const seen = new Set<string>();
    for (const l of doc.lines) {
      const key = `${l.itemId}|${l.batchId ?? l.newBatchNumber ?? ''}`;
      if (seen.has(key)) throw new BadRequestException(`${l.item.code} is listed twice`);
      seen.add(key);
      let batchId = l.batchId;
      if (!batchId && l.newBatchNumber) batchId = (await this.ensureBatch(tx, l.itemId, l.newBatchNumber, iso(l.newManufactureOn), iso(l.newExpiryOn), actor)).id;
      const expected = await this.quantityAt(tx, l.itemId, locationId, batchId, doc.postingAt);
      const counted = D(l.countedQuantity ?? '0');
      await tx.stockDocumentLine.update({ where: { id: l.id }, data: { expectedQuantity: expected.toString(), batchId } });
      const diff = counted.sub(expected);
      const base = { companyId: doc.companyId, documentId: doc.id, documentLineId: l.id, itemId: l.itemId, locationId, postingDate: iso(doc.postingDate)!, postingAt: doc.postingAt, accountRole: role };
      if (doc.countType === 'opening' && counted.gt(0) && l.unitCost === null) throw new BadRequestException(`${l.item.code}: opening stock needs a cost`);
      if (!l.item.trackBatches && !l.item.trackSerials) {
        const position = await tx.stockPosition.findUnique({ where: { itemId_locationId: { itemId: l.itemId, locationId } } });
        const costChanges = l.unitCost !== null && !(position && D(position.unitCost).eq(D(l.unitCost)));
        if (diff.abs().lte(QUANTITY_TOLERANCE) && !costChanges) continue; // nothing to change on this line
        movements.push({ ...base, kind: 'set', quantity: counted.toString(), targetCost: l.unitCost?.toString() ?? null });
      } else {
        if (diff.abs().lte(QUANTITY_TOLERANCE)) continue;
        movements.push(
          diff.gt(0)
            ? { ...base, batchId, kind: 'in', quantity: diff.toString(), incomingCost: (l.unitCost ?? (await this.currentCost(tx, l.itemId, locationId))).toString() }
            : { ...base, batchId, kind: 'out', quantity: diff.neg().toString() },
        );
      }
    }
    if (!movements.length) throw new BadRequestException('Nothing to change: every counted quantity matches the stock');
    const entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe });
    await this.applyCountSerials(tx, doc, actor);
    return entries;
  }

  // ---- Checks ----

  private requireRight(user: CurrentUser, key: PermissionKey) {
    if (!hasPermission(user, key)) throw new ForbiddenException(`You do not have the right "${key}"`);
  }

  private requireDraftRight(kind: string, user: CurrentUser) {
    this.requireRight(user, kind === 'move' || kind === 'transfer_send' || kind === 'transfer_receive' ? 'stock.move' : 'stock.count');
  }

  /** Approved plan question 4: staff draft, Store Manager (or above) finalises stock-ins, write-offs and counts. */
  private requireFinaliseRight(kind: string, user: CurrentUser) {
    this.requireRight(user, kind === 'move' || kind === 'transfer_send' || kind === 'transfer_receive' ? 'stock.move' : 'stock.adjust_finalise');
  }

  private assertDocAccess(doc: StockDocument, user: CurrentUser) {
    if (user.allStores) return;
    const ok = user.stores.some((s) => s.id === doc.storeId || s.id === doc.toStoreId);
    if (!ok) throw new ForbiddenException('You are not allowed to work in this store');
  }

  private async transitId(db: Db, companyId: string): Promise<string> {
    const settings = await db.inventorySettings.findUnique({ where: { companyId } });
    if (!settings?.transitLocationId) throw new BadRequestException('The company has no transit location');
    return settings.transitLocationId;
  }

  private async assertLocation(db: Db, companyId: string, id: string, opts: { storeId?: string; allowTransit: boolean }): Promise<StockLocation> {
    const loc = await db.stockLocation.findUnique({ where: { id } });
    if (!loc || loc.companyId !== companyId) throw new BadRequestException('Location not found');
    if (!loc.active) throw new BadRequestException(`Location ${loc.name} is switched off`);
    if (loc.kind === 'folder') throw new BadRequestException(`${loc.name} is a folder; choose a location inside it`);
    if (loc.kind === 'transit' && !opts.allowTransit) throw new BadRequestException('Transit can only be used through transfers');
    if (opts.storeId && loc.kind !== 'transit' && loc.storeId !== opts.storeId) throw new BadRequestException(`${loc.name} belongs to another store`);
    return loc;
  }

  private async defaultShelf(db: Db, storeId: string): Promise<StockLocation> {
    const loc = await db.stockLocation.findFirst({ where: { storeId, kind: 'shelf', active: true }, orderBy: { code: 'desc' } }); // "-FLOOR" sorts after "-BACK"
    if (!loc) throw new BadRequestException('The receiving store has no shelf location');
    return loc;
  }

  private async checkHeader(
    db: Db,
    companyId: string,
    kind: string,
    input: { reason?: string | null; storeId: string; fromLocationId?: string | null; toLocationId?: string | null; toStoreId?: string | null },
  ): Promise<{ fromLocationId: string | null; toLocationId: string | null; toStoreId: string | null }> {
    switch (kind) {
      case 'stock_in': {
        if (!input.reason || !(STOCK_IN_REASONS as readonly string[]).includes(input.reason)) throw new BadRequestException(`Choose a reason: ${STOCK_IN_REASONS.join(', ')}`);
        if (!input.toLocationId) throw new BadRequestException('Choose where the stock goes');
        const to = await this.assertLocation(db, companyId, input.toLocationId, { storeId: input.storeId, allowTransit: false });
        return { fromLocationId: null, toLocationId: to.id, toStoreId: null };
      }
      case 'stock_out': {
        if (!input.reason || !(STOCK_OUT_REASONS as readonly string[]).includes(input.reason)) throw new BadRequestException(`Choose a reason: ${STOCK_OUT_REASONS.join(', ')}`);
        if (!input.fromLocationId) throw new BadRequestException('Choose where the stock leaves from');
        const from = await this.assertLocation(db, companyId, input.fromLocationId, { storeId: input.storeId, allowTransit: false });
        return { fromLocationId: from.id, toLocationId: null, toStoreId: null };
      }
      case 'move': {
        if (!input.fromLocationId || !input.toLocationId) throw new BadRequestException('Choose both locations');
        if (input.fromLocationId === input.toLocationId) throw new BadRequestException('The two locations must differ');
        const from = await this.assertLocation(db, companyId, input.fromLocationId, { storeId: input.storeId, allowTransit: false });
        const to = await this.assertLocation(db, companyId, input.toLocationId, { storeId: input.storeId, allowTransit: false });
        return { fromLocationId: from.id, toLocationId: to.id, toStoreId: null };
      }
      case 'transfer_send': {
        if (!input.toStoreId) throw new BadRequestException('Choose the receiving store');
        if (input.toStoreId === input.storeId) throw new BadRequestException('A transfer goes to a different store; use a move inside one store');
        const toStore = await db.store.findFirst({ where: { id: input.toStoreId, companyId, active: true } });
        if (!toStore) throw new BadRequestException('Receiving store not found or switched off');
        if (!input.fromLocationId) throw new BadRequestException('Choose where the stock leaves from');
        const from = await this.assertLocation(db, companyId, input.fromLocationId, { storeId: input.storeId, allowTransit: false });
        // Decision 37: every transfer goes through transit, even between nearby shops.
        return { fromLocationId: from.id, toLocationId: await this.transitId(db, companyId), toStoreId: toStore.id };
      }
      default:
        throw new BadRequestException('Unknown kind of stock document');
    }
  }

  private async resolveLines(db: Db, kind: string, lines: StockLineInput[], _forCount: boolean): Promise<ResolvedLine[]> {
    const out: ResolvedLine[] = [];
    for (const [i, l] of lines.entries()) {
      const item = await this.items.assertItemUsable(db, l.itemId, 'stock');
      const { unitId, factor, basicQuantity, quantity } = await this.unitQuantities(db, item, l.unitId, l.quantity);
      let batchId: string | null = null;
      let newBatchNumber: string | null = null;
      let newManufactureOn: string | null = null;
      let newExpiryOn: string | null = null;
      if (item.trackBatches) {
        if (l.batchId) {
          const batch = await db.batch.findUnique({ where: { id: l.batchId } });
          if (!batch || batch.itemId !== item.id) throw new BadRequestException(`${item.code}: batch not found`);
          batchId = batch.id;
        } else if (kind === 'stock_in') {
          if (!l.batchNumber && !item.autoNumberBatches) throw new BadRequestException(`${item.code}: give a batch number`);
          newBatchNumber = l.batchNumber ?? null;
          newManufactureOn = l.manufactureDate ?? null;
          newExpiryOn = l.expiryDate ?? (l.manufactureDate && item.shelfLifeDays ? expiryFromShelfLife(l.manufactureDate, item.shelfLifeDays) : null);
          if (item.shelfLifeDays && !newExpiryOn) throw new BadRequestException(`${item.code}: give the expiry date or the manufacture date`);
        } else {
          throw new BadRequestException(`${item.code}: choose the batch`);
        }
      } else if (l.batchId || l.batchNumber) {
        throw new BadRequestException(`${item.code} is not tracked by batch`);
      }
      const serials = (l.serialNumbers ?? []).map((s) => s.trim());
      if (item.trackSerials) {
        if (!basicQuantity.isInteger() || !basicQuantity.eq(serials.length)) throw new BadRequestException(`${item.code}: list exactly ${basicQuantity.toString()} serial numbers`);
        if (new Set(serials).size !== serials.length) throw new BadRequestException(`${item.code}: a serial number is listed twice`);
      } else if (serials.length) {
        throw new BadRequestException(`${item.code} is not tracked by serial number`);
      }
      if (kind === 'stock_in' && (l.unitCost === undefined || l.unitCost === null)) throw new BadRequestException(`${item.code}: give the cost per unit`);
      out.push({
        lineNo: i + 1,
        item,
        unitId,
        quantity,
        factor,
        basicQuantity,
        batchId,
        newBatchNumber,
        newManufactureOn,
        newExpiryOn,
        serialNumbers: serials,
        unitCost: kind === 'stock_in' && l.unitCost != null ? D(l.unitCost).div(factor) : null,
      });
    }
    return out;
  }

  private async resolveCountLines(db: Db, lines: CountLineInput[]): Promise<ResolvedLine[]> {
    const out: ResolvedLine[] = [];
    for (const [i, l] of lines.entries()) {
      const item = await this.items.assertItemUsable(db, l.itemId, 'stock');
      const unit = await db.unit.findUniqueOrThrow({ where: { id: item.baseUnitId } });
      const problem = quantityProblem(l.countedQuantity, unit);
      if (problem) throw new BadRequestException(`${item.code}: ${problem}`);
      const serials = (l.serialNumbers ?? []).map((s) => s.trim());
      if (item.trackSerials && !D(l.countedQuantity).eq(serials.length)) throw new BadRequestException(`${item.code}: list the ${l.countedQuantity} serial numbers counted`);
      if (item.trackBatches && !l.batchId && !l.batchNumber) throw new BadRequestException(`${item.code}: count each batch separately`);
      out.push({
        lineNo: i + 1,
        item,
        unitId: item.baseUnitId,
        quantity: D(l.countedQuantity),
        factor: new Decimal(1),
        basicQuantity: D(l.countedQuantity),
        batchId: l.batchId ?? null,
        newBatchNumber: l.batchId ? null : (l.batchNumber ?? null),
        newManufactureOn: null,
        newExpiryOn: l.expiryDate ?? null,
        serialNumbers: serials,
        unitCost: l.unitCost != null ? D(l.unitCost) : null,
        countedQuantity: D(l.countedQuantity),
      });
    }
    return out;
  }

  private async unitQuantities(db: Db, item: Item, unitId: string | undefined, qty: string) {
    const uid = unitId ?? item.baseUnitId;
    const itemUnit = await db.itemUnit.findUnique({ where: { itemId_unitId: { itemId: item.id, unitId: uid } }, include: { unit: true } });
    if (!itemUnit) throw new BadRequestException(`${item.code}: the unit must be one of the item’s units`);
    const problem = quantityProblem(qty, itemUnit.unit);
    if (problem) throw new BadRequestException(`${item.code}: ${problem}`);
    const quantity = roundQuantity(qty);
    const factor = D(itemUnit.factor);
    return { unitId: uid, factor, quantity, basicQuantity: roundQuantity(quantity.mul(factor)) };
  }

  /** Lock date, open financial year, no future dates (rule 15; decision 36). */
  private async checkDates(db: Db, doc: Pick<StockDocument, 'postingDate' | 'companyId'>, _user: CurrentUser) {
    const date = iso(doc.postingDate)!;
    if (date > businessDate()) throw new BadRequestException('Stock movements cannot be dated in the future');
    const settings = await db.inventorySettings.findUnique({ where: { companyId: doc.companyId } });
    if (settings?.stockLockDate && date <= iso(settings.stockLockDate)!) {
      throw new BadRequestException(`Stock is locked up to ${iso(settings.stockLockDate)}; nothing can be posted on or before that date`);
    }
    const year = await this.years.forDate(db, doc.companyId, date);
    if (!year) throw new BadRequestException(`No financial year covers ${date}`);
    if (year.status !== 'open') throw new BadRequestException(`Financial year ${year.name} is locked`);
  }

  /** Decision 35: dated before a later movement → Accountant only, current month only. */
  private async checkBackdating(tx: Db, doc: DocumentRow, user: CurrentUser) {
    const locations = [doc.fromLocationId, doc.toLocationId].filter((l): l is string => !!l);
    const later = await tx.stockLedgerEntry.findFirst({
      where: { itemId: { in: doc.lines.map((l) => l.itemId) }, locationId: { in: locations }, postingAt: { gt: doc.postingAt } },
      select: { id: true },
    });
    if (!later) return;
    if (!hasPermission(user, 'stock.backdate')) {
      throw new ForbiddenException('Later movements of these items exist; only the Accountant may post an earlier date');
    }
    if (iso(doc.postingDate)!.slice(0, 7) !== businessDate().slice(0, 7)) {
      throw new ForbiddenException('Back-dated stock entries are allowed only within the current month');
    }
    doc.isBackDated = true;
  }

  // ---- Batches and serials ----

  private async ensureBatch(tx: Db, itemId: string, batchNumber: string | null, manufactureOn: string | null, expiryOn: string | null, actor: Actor) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
    let number = batchNumber;
    if (!number) {
      // Automatic numbering: item code + date + a running suffix that does not exist yet.
      const stem = `${item.code}-${businessDate().replace(/-/g, '')}`;
      for (let n = 1; ; n++) {
        const candidate = `${stem}-${n}`;
        if (!(await tx.batch.findUnique({ where: { itemId_batchNumber: { itemId, batchNumber: candidate } } }))) {
          number = candidate;
          break;
        }
      }
    }
    const existing = await tx.batch.findUnique({ where: { itemId_batchNumber: { itemId, batchNumber: number } } });
    if (existing) return existing;
    return tx.batch.create({
      data: { itemId, batchNumber: number, manufactureDate: manufactureOn ? fromIso(manufactureOn) : null, expiryDate: expiryOn ? fromIso(expiryOn) : null, createdById: actor.userId, updatedById: actor.userId },
    });
  }

  /** Creates new batches named on stock-in lines and enforces decision 13 on every batch line. */
  private async prepareBatches(tx: Db, doc: DocumentRow, actor: Actor) {
    for (const l of doc.lines) {
      if (!l.item.trackBatches) continue;
      if (!l.batchId) {
        const batch = await this.ensureBatch(tx, l.itemId, l.newBatchNumber, iso(l.newManufactureOn), iso(l.newExpiryOn), actor);
        await tx.stockDocumentLine.update({ where: { id: l.id }, data: { batchId: batch.id } });
        l.batchId = batch.id;
        l.batch = { id: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate };
      }
      const batch = await tx.batch.findUniqueOrThrow({ where: { id: l.batchId } });
      // Decision 13: an expired batch can only leave as a write-off for expiry; no override.
      if (isExpiredOn(iso(batch.expiryDate), iso(doc.postingDate)!) && !(doc.kind === 'stock_out' && doc.reason === 'expiry')) {
        throw new BadRequestException(`Batch ${batch.batchNumber} of ${l.item.code} expired on ${iso(batch.expiryDate)}; it can only be written off with reason "expiry"`);
      }
    }
  }

  private async applySerials(tx: Db, doc: DocumentRow, mode: 'finalise' | 'cancel', actor: Actor) {
    for (const l of doc.lines) {
      if (!l.item.trackSerials || !l.serialNumbers.length) continue;
      const serials = l.serialNumbers;
      const find = () => tx.serialNumber.findMany({ where: { itemId: l.itemId, serial: { in: serials } } });
      const set = (data: Prisma.SerialNumberUpdateManyMutationInput) => tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: serials } }, data: { ...data, updatedById: actor.userId } });
      const expect = async (status: string, locationId: string | null, what: string) => {
        const rows = await find();
        const bad = serials.filter((s) => !rows.some((r) => r.serial === s && r.status === status && (locationId === null || r.locationId === locationId)));
        if (bad.length) throw new BadRequestException(`${l.item.code}: serial ${bad.join(', ')} ${what}`);
      };
      if (mode === 'finalise') {
        switch (doc.kind) {
          case 'stock_in': {
            const existing = await find();
            const inStock = existing.filter((r) => r.status !== 'out');
            if (inStock.length) throw new BadRequestException(`${l.item.code}: serial ${inStock.map((r) => r.serial).join(', ')} is already in stock`);
            for (const s of serials) {
              await tx.serialNumber.upsert({
                where: { itemId_serial: { itemId: l.itemId, serial: s } },
                create: { itemId: l.itemId, serial: s, status: 'in_stock', locationId: doc.toLocationId, batchId: l.batchId, inDocumentId: doc.id, createdById: actor.userId, updatedById: actor.userId },
                update: { status: 'in_stock', locationId: doc.toLocationId, batchId: l.batchId, inDocumentId: doc.id, outDocumentId: null, updatedById: actor.userId },
              });
            }
            break;
          }
          case 'stock_out':
            await expect('in_stock', doc.fromLocationId, `is not in stock at this location`);
            await set({ status: 'out', locationId: null, outDocumentId: doc.id });
            break;
          case 'move':
            await expect('in_stock', doc.fromLocationId, `is not in stock at this location`);
            await set({ locationId: doc.toLocationId });
            break;
          case 'transfer_send':
            await expect('in_stock', doc.fromLocationId, `is not in stock at this location`);
            await set({ status: 'in_transit', locationId: doc.toLocationId });
            break;
          case 'transfer_receive':
            await expect('in_transit', null, `is not in transit`);
            await set({ status: 'in_stock', locationId: doc.toLocationId });
            break;
        }
      } else {
        switch (doc.kind) {
          case 'stock_in':
            await set({ status: 'out', locationId: null, outDocumentId: doc.id });
            break;
          case 'stock_out':
            await set({ status: 'in_stock', locationId: doc.fromLocationId, outDocumentId: null });
            break;
          case 'move':
            await set({ locationId: doc.fromLocationId });
            break;
          case 'transfer_send':
            await set({ status: 'in_stock', locationId: doc.fromLocationId });
            break;
          case 'transfer_receive':
            await set({ status: 'in_transit', locationId: doc.fromLocationId });
            break;
        }
      }
    }
  }

  /** Serial counts: the listed serials are the full set at the location; missing ones go out, new ones come in. */
  private async applyCountSerials(tx: Db, doc: DocumentRow, actor: Actor) {
    for (const l of doc.lines) {
      if (!l.item.trackSerials) continue;
      const listed = new Set(l.serialNumbers);
      const here = await tx.serialNumber.findMany({ where: { itemId: l.itemId, locationId: doc.toLocationId, status: 'in_stock' } });
      const missing = here.filter((s) => !listed.has(s.serial)).map((s) => s.serial);
      if (missing.length) await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: missing } }, data: { status: 'out', locationId: null, outDocumentId: doc.id, updatedById: actor.userId } });
      for (const s of listed) {
        if (here.some((h) => h.serial === s)) continue;
        await tx.serialNumber.upsert({
          where: { itemId_serial: { itemId: l.itemId, serial: s } },
          create: { itemId: l.itemId, serial: s, status: 'in_stock', locationId: doc.toLocationId, inDocumentId: doc.id, createdById: actor.userId, updatedById: actor.userId },
          update: { status: 'in_stock', locationId: doc.toLocationId, inDocumentId: doc.id, updatedById: actor.userId },
        });
      }
    }
  }

  // ---- Small helpers ----

  private async quantityAt(tx: Db, itemId: string, locationId: string, batchId: string | null, at: Date): Promise<Decimal> {
    if (batchId) {
      const sum = await tx.stockLedgerEntry.aggregate({ where: { itemId, locationId, batchId, postingAt: { lte: at } }, _sum: { quantityChange: true } });
      return D(sum._sum.quantityChange ?? '0');
    }
    const last = await tx.stockLedgerEntry.findFirst({ where: { itemId, locationId, postingAt: { lte: at } }, orderBy: [{ postingAt: 'desc' }, { id: 'desc' }] });
    return last ? D(last.quantityAfter) : new Decimal(0);
  }

  private async currentCost(tx: Db, itemId: string, locationId: string): Promise<string> {
    const p = await tx.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
    if (p && D(p.unitCost).gt(0)) return p.unitCost.toString();
    throw new BadRequestException('Give a cost for the extra stock found');
  }

  /** "ITM-000001 Basmati Rice 1 kg at Shop floor (MAIN)" for error messages. */
  private async describer(tx: Db, doc: DocumentRow): Promise<(itemId: string, locationId: string) => string> {
    const items = new Map(doc.lines.map((l) => [l.itemId, `${l.item.code} ${l.item.name}`]));
    const ids = [doc.fromLocationId, doc.toLocationId].filter((x): x is string => !!x);
    const locs = await tx.stockLocation.findMany({ where: { id: { in: ids } }, include: { store: { select: { code: true } } } });
    const locations = new Map(locs.map((l) => [l.id, l.store ? `${l.name} (${l.store.code})` : l.name]));
    return (itemId, locationId) => `${items.get(itemId) ?? 'item'}${locations.has(locationId) ? ` at ${locations.get(locationId)}` : ''}`;
  }

  private async storeLineValues(tx: Db, doc: DocumentRow, entries: StockLedgerEntry[]) {
    const byLine = new Map<string, Decimal>();
    for (const e of entries) {
      // A line's value is what left (out legs) or arrived (in legs) on its first location.
      const key = e.documentLineId;
      if (!byLine.has(key)) byLine.set(key, D(e.valueChange).abs());
    }
    for (const [lineId, value] of byLine) await tx.stockDocumentLine.update({ where: { id: lineId }, data: { valueChange: value.toFixed(2) } });
  }

  // ---- Output ----

  private header(d: StockDocument, showCost: boolean) {
    return {
      id: d.id,
      number: d.number,
      kind: d.kind,
      reason: d.reason,
      countType: d.countType,
      status: d.status,
      postingDate: iso(d.postingDate),
      postingAt: d.postingAt,
      storeId: d.storeId,
      toStoreId: d.toStoreId,
      fromLocationId: d.fromLocationId,
      toLocationId: d.toLocationId,
      sendDocumentId: d.sendDocumentId,
      remarks: d.remarks,
      isBackDated: d.isBackDated,
      ...(showCost ? { totalValueIn: d.totalValueIn.toFixed(2), totalValueOut: d.totalValueOut.toFixed(2) } : {}),
      cancelReason: d.cancelReason,
      createdAt: d.createdAt,
      finalisedAt: d.finalisedAt,
    };
  }

  toDto(d: DocumentRow, user: CurrentUser) {
    const showCost = hasPermission(user, 'stock.cost.view');
    const hideExpected = d.blind && d.status === 'draft' && !hasPermission(user, 'stock.adjust_finalise');
    return {
      ...this.header(d, showCost),
      blind: d.blind,
      lines: d.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        item: { id: l.item.id, code: l.item.code, name: l.item.name, trackBatches: l.item.trackBatches, trackSerials: l.item.trackSerials },
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        factor: l.factor.toString(),
        basicQuantity: l.basicQuantity.toString(),
        batch: l.batch ? { id: l.batch.id, batchNumber: l.batch.batchNumber, expiryDate: iso(l.batch.expiryDate) } : null,
        newBatchNumber: l.newBatchNumber,
        newExpiryOn: iso(l.newExpiryOn),
        serialNumbers: l.serialNumbers,
        ...(showCost ? { unitCost: l.unitCost?.toFixed(4) ?? null, valueChange: l.valueChange.toFixed(2) } : {}),
        expectedQuantity: hideExpected ? null : (l.expectedQuantity?.toString() ?? null),
        countedQuantity: l.countedQuantity?.toString() ?? null,
        receivedQuantity: l.receivedQuantity.toString(),
        sendLineId: l.sendLineId,
      })),
    };
  }
}

function lineData(l: ResolvedLine) {
  return {
    lineNo: l.lineNo,
    itemId: l.item.id,
    unitId: l.unitId,
    quantity: l.quantity.toString(),
    factor: l.factor.toString(),
    basicQuantity: l.basicQuantity.toString(),
    batchId: l.batchId,
    newBatchNumber: l.newBatchNumber,
    newManufactureOn: l.newManufactureOn ? fromIso(l.newManufactureOn) : null,
    newExpiryOn: l.newExpiryOn ? fromIso(l.newExpiryOn) : null,
    serialNumbers: l.serialNumbers,
    unitCost: l.unitCost ? l.unitCost.toFixed(4) : null,
    countedQuantity: l.countedQuantity ? l.countedQuantity.toString() : null,
  };
}

function totals(entries: StockLedgerEntry[]) {
  let valueIn = new Decimal(0);
  let valueOut = new Decimal(0);
  for (const e of entries) {
    const v = D(e.valueChange);
    if (v.gt(0)) valueIn = valueIn.add(v);
    else valueOut = valueOut.add(v.neg());
  }
  return { totalValueIn: valueIn.toFixed(2), totalValueOut: valueOut.toFixed(2) };
}

function summarise(d: DocumentRow): Record<string, unknown> {
  return {
    reason: d.reason,
    postingDate: iso(d.postingDate),
    fromLocationId: d.fromLocationId,
    toLocationId: d.toLocationId,
    toStoreId: d.toStoreId,
    remarks: d.remarks,
    blind: d.blind,
    lines: d.lines.map((l) => `${l.item.code}×${l.quantity.toString()}${l.countedQuantity ? `=${l.countedQuantity.toString()}` : ''}`),
  };
}
