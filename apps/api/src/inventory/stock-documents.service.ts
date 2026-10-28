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
import { assertModuleOn } from '../modules/module-map.js';
import { lockRows, lockStillAt } from '../common/row-lock.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { seriesKind } from './location-defaults.js';
import { type Movement, StockEngine } from './stock-engine.service.js';
import { TransferGstService } from './transfer-gst.service.js';

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

/**
 * Audit 3 (28 October 2026): a draft dated today whose time was never typed was stamped with the
 * moment it was made; finalised later it would sit before the sales made in between. Such a draft
 * takes the moment it is finalised instead. (A typed time is kept.)
 */
export function untypedToday(row: { postingDate: Date; postingAt: Date; createdAt: Date; updatedAt: Date }): boolean {
  if (row.postingDate.toISOString().slice(0, 10) !== businessDate()) return false;
  const near = (d: Date) => Math.abs(row.postingAt.getTime() - d.getTime()) < 2000;
  return near(row.createdAt) || near(row.updatedAt);
}

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
    private readonly transferGst: TransferGstService,
    private readonly ledger: LedgerService,
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
    // Plan 12: sending stock to another shop belongs to "Transfers between shops".
    if (input.kind === 'transfer_send') await assertModuleOn(this.prisma, 'transfers');
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
    this.assertDocAccess(before, user, 'change');
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
      await lockStillAt(tx, 'StockDocument', id, 'draft', 'Only drafts can be changed; it was just finalised or cancelled');
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
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      for (let i = 0; i < lines.length; i += 2000) await tx.stockDocumentLine.createMany({ data: lines.slice(i, i + 2000).map((l) => ({ ...lineData(l), documentId: doc.id })) });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'stock_document', entityId: doc.id, changes: { number, kind: 'count', countType: input.countType, lines: lines.length } });
      return this.fillExpected(tx, await this.getRow(tx, doc.id));
    }, { timeout: 120_000, maxWait: 30_000 });
    return this.toDto(created, user);
  }

  /** Draft counts show what the system expects at the count's time (hidden from counters on a blind count). */
  private async fillExpected(tx: Db, doc: DocumentRow): Promise<DocumentRow> {
    // Lines without a batch in bulk (plan 11 A5); batch lines one by one.
    const plain = doc.lines.filter((l) => !l.batchId);
    const latest = new Map(
      (
        await tx.$queryRawUnsafe<{ itemId: string; quantityAfter: Prisma.Decimal }[]>(
          `SELECT DISTINCT ON ("itemId") "itemId", "quantityAfter" FROM "StockLedgerEntry"
           WHERE "locationId" = $1::uuid AND "itemId" = ANY($2::uuid[]) AND "postingAt" <= $3::timestamp(3)
           ORDER BY "itemId", "postingAt" DESC, "id" DESC`,
          doc.toLocationId!,
          plain.map((l) => l.itemId),
          doc.postingAt.toISOString().replace('Z', ''),
        )
      ).map((r) => [r.itemId, D(r.quantityAfter).toString()]),
    );
    for (let i = 0; i < plain.length; i += 5000) {
      const chunk = plain.slice(i, i + 5000);
      await tx.$executeRawUnsafe(
        `UPDATE "StockDocumentLine" d SET "expectedQuantity" = t.q::numeric FROM unnest($1::uuid[], $2::text[]) AS t(i, q) WHERE d."id" = t.i`,
        chunk.map((l) => l.id),
        chunk.map((l) => latest.get(l.itemId) ?? '0'),
      );
    }
    for (const l of doc.lines.filter((x) => x.batchId)) {
      const expected = await this.quantityAt(tx, l.itemId, doc.toLocationId!, l.batchId, doc.postingAt);
      await tx.stockDocumentLine.update({ where: { id: l.id }, data: { expectedQuantity: expected.toString() } });
    }
    return this.getRow(tx, doc.id);
  }

  async updateCount(id: string, input: UpdateCountInput, actor: Actor, user: CurrentUser) {
    const before = await this.getRow(this.prisma, id);
    this.assertDocAccess(before, user, 'change');
    if (before.kind !== 'count') throw new BadRequestException('Not a stock count');
    if (before.status !== 'draft') throw new BadRequestException('Only drafts can be changed');
    this.requireRight(user, 'stock.count');
    const location = input.locationId ? await this.assertLocation(this.prisma, before.companyId, input.locationId, { storeId: before.storeId, allowTransit: false }) : null;
    const lines = input.lines ? await this.resolveCountLines(this.prisma, input.lines) : null;
    const postingDate = input.postingDate ?? iso(before.postingDate)!;
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockStillAt(tx, 'StockDocument', id, 'draft', 'Only drafts can be changed; it was just finalised or cancelled');
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
    this.assertDocAccess(doc, user, 'change');
    if (doc.status !== 'draft') throw new BadRequestException(`Document is already ${doc.status}`);
    this.requireFinaliseRight(doc.kind, user);
    if (doc.kind === 'transfer_send') await assertModuleOn(this.prisma, 'transfers');
    await this.checkDates(this.prisma, doc, user);

    const finalised = await this.prisma.$transaction(
      async (tx) => {
        await lockStillAt(tx, 'StockDocument', id, 'draft', 'This document was just finalised or cancelled');
        let fresh = await this.getRow(tx, id);
        // Not a count: a count keeps the moment the shelf was counted, and the sales after it replay on top.
        if (fresh.kind !== 'count' && untypedToday(fresh)) {
          await tx.stockDocument.update({ where: { id }, data: { postingAt: new Date() } });
          fresh = await this.getRow(tx, id);
        }
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
        // Plan 08 G10: between stores under different GSTINs the send is a taxable supply.
        await this.transferGst.onSend(tx, fresh, actor.userId);
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

  /**
   * Audit 3 #16 (owner, 28 October 2026): goods that never arrived (lost or damaged on the way) are
   * written off from transit, so a part-received transfer can be finished. At their transit cost,
   * against Write-off in the sending store; their serials are marked out; nothing more can be received.
   */
  async closeShort(sendId: string, reason: string, actor: Actor, user: CurrentUser) {
    this.requireRight(user, 'stock.adjust_finalise');
    const doc = await this.getRow(this.prisma, sendId);
    if (doc.kind !== 'transfer_send') throw new BadRequestException('Only a transfer can be closed short');
    this.assertDocAccess(doc, user, 'change');
    const today = businessDate();
    const done = await this.prisma.$transaction(
      async (tx) => {
        await lockStillAt(tx, 'StockDocument', sendId, 'finalised', 'Only a sent transfer can be closed short');
        await lockRows(tx, 'StockDocumentLine', doc.lines.map((l) => l.id));
        const lines = await tx.stockDocumentLine.findMany({ where: { documentId: sendId }, include: { item: true } });
        const open = lines.map((l) => ({ l, q: D(l.basicQuantity).sub(D(l.receivedQuantity)) })).filter((x) => x.q.gt(QUANTITY_TOLERANCE));
        if (!open.length) throw new BadRequestException('Nothing of this transfer is still on the way');
        const transitId = await this.transitId(tx, doc.companyId);
        const movements: Movement[] = [];
        for (const { l, q } of open) {
          const source = await tx.stockLedgerEntry.findFirst({ where: { documentId: sendId, documentLineId: l.id, kind: 'in', locationId: transitId, isCancellation: false } });
          movements.push({ companyId: doc.companyId, documentId: sendId, documentLineId: l.id, itemId: l.itemId, locationId: transitId, batchId: l.batchId, postingDate: today, postingAt: new Date(), kind: 'out', quantity: q.toString(), costSourceId: source?.id ?? null, accountRole: 'write_off', ledger: 'held' });
        }
        const entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, doc) });
        const value = entries.reduce((s, e) => s.sub(D(e.valueChange)), new Decimal(0));
        await this.ledger.post(tx, {
          companyId: doc.companyId,
          date: today,
          documentType: 'transfer_short',
          documentId: sendId,
          documentNumber: doc.number,
          storeId: doc.storeId,
          actorId: actor.userId,
          remark: `Not received: ${reason}`,
          lines: [
            { role: 'write_off', storeId: doc.storeId, debit: value },
            { role: 'goods_in_transit', credit: value },
          ],
        });
        await this.ledger.markPosted(tx, entries.map((e) => e.id));
        for (const { l, q } of open) {
          await tx.stockDocumentLine.update({ where: { id: l.id }, data: { receivedQuantity: D(l.basicQuantity).toString() } });
          if (l.item.trackSerials && l.serialNumbers.length) {
            await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: l.serialNumbers }, status: 'in_transit' }, data: { status: 'out', locationId: null, outDocumentId: sendId, updatedById: actor.userId } });
          }
          void q;
        }
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'stock_document',
          entityId: sendId,
          changes: { closedShort: open.map(({ l, q }) => `${l.item.code} × ${q.toString()}`), value: value.toFixed(2) },
          reason,
        });
        return this.getRow(tx, sendId);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(done, user);
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
        // Audit 3 (28 October 2026): only serials that were sent on this transfer.
        const notSent = serials.filter((s) => line.serialNumbers.length && !line.serialNumbers.includes(s));
        if (notSent.length) throw new BadRequestException(`${line.item.code}: serial ${notSent.join(', ')} was not sent on this transfer`);
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
        // Audit 3 (28 October 2026): the send cannot be cancelled while it is being received.
        await lockStillAt(tx, 'StockDocument', send.id, 'finalised', 'This transfer was just cancelled');
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
    this.assertDocAccess(doc, user, 'change');
    if (doc.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (doc.status === 'draft') {
      this.requireDraftRight(doc.kind, user);
      const after = await this.prisma.$transaction(async (tx) => {
        await lockStillAt(tx, 'StockDocument', id, 'draft', 'This document was just changed; open it again');
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
        await lockStillAt(tx, 'StockDocument', id, doc.status, 'This document was just changed; open it again');
        const lineFor = new Map(doc.lines.map((l) => [l.id, l.id]));
        await this.engine.reverseDocument(tx, id, (e) => lineFor.get(e.documentLineId) ?? e.documentLineId, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, doc) });
        await this.applySerials(tx, doc, 'cancel', actor);
        if (doc.kind === 'transfer_send') await this.transferGst.onCancel(tx, id, actor.userId);
        if (doc.kind === 'transfer_receive') {
          await lockRows(tx, 'StockDocumentLine', doc.lines.map((l) => l.sendLineId));
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
    // Plan 11 A5: plain items (no batches or serials) are looked up and noted in bulk, so a count of any size finishes in time.
    const plain = doc.lines.filter((l) => !l.batchId && !l.newBatchNumber && !l.item.trackBatches && !l.item.trackSerials);
    const plainIds = plain.map((l) => l.itemId);
    const expectedPlain = new Map(
      (
        await tx.$queryRawUnsafe<{ itemId: string; quantityAfter: Prisma.Decimal }[]>(
          `SELECT DISTINCT ON ("itemId") "itemId", "quantityAfter" FROM "StockLedgerEntry"
           WHERE "locationId" = $1::uuid AND "itemId" = ANY($2::uuid[]) AND "postingAt" <= $3::timestamp(3)
           ORDER BY "itemId", "postingAt" DESC, "id" DESC`,
          locationId,
          plainIds,
          doc.postingAt.toISOString().replace('Z', ''),
        )
      ).map((r) => [r.itemId, D(r.quantityAfter)]),
    );
    const positionsPlain = new Map((await tx.stockPosition.findMany({ where: { locationId, itemId: { in: plainIds } } })).map((p) => [p.itemId, p]));
    const plainLineIds = new Set(plain.map((l) => l.id));
    const noted: { id: string; expected: string }[] = [];
    for (const l of doc.lines) {
      const key = `${l.itemId}|${l.batchId ?? l.newBatchNumber ?? ''}`;
      if (seen.has(key)) throw new BadRequestException(`${l.item.code} is listed twice`);
      seen.add(key);
      let batchId = l.batchId;
      let expected: Decimal;
      if (plainLineIds.has(l.id)) {
        expected = expectedPlain.get(l.itemId) ?? new Decimal(0);
        noted.push({ id: l.id, expected: expected.toString() });
      } else {
        if (!batchId && l.newBatchNumber) batchId = (await this.ensureBatch(tx, l.itemId, l.newBatchNumber, iso(l.newManufactureOn), iso(l.newExpiryOn), actor)).id;
        expected = await this.quantityAt(tx, l.itemId, locationId, batchId, doc.postingAt);
        await tx.stockDocumentLine.update({ where: { id: l.id }, data: { expectedQuantity: expected.toString(), batchId } });
      }
      const counted = D(l.countedQuantity ?? '0');
      const diff = counted.sub(expected);
      const base = { companyId: doc.companyId, documentId: doc.id, documentLineId: l.id, itemId: l.itemId, locationId, postingDate: iso(doc.postingDate)!, postingAt: doc.postingAt, accountRole: role };
      if (doc.countType === 'opening' && counted.gt(0) && l.unitCost === null) throw new BadRequestException(`${l.item.code}: opening stock needs a cost`);
      if (!l.item.trackBatches && !l.item.trackSerials) {
        const position = plainLineIds.has(l.id) ? positionsPlain.get(l.itemId) : await tx.stockPosition.findUnique({ where: { itemId_locationId: { itemId: l.itemId, locationId } } });
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
    for (let i = 0; i < noted.length; i += 5000) {
      const chunk = noted.slice(i, i + 5000);
      await tx.$executeRawUnsafe(
        `UPDATE "StockDocumentLine" d SET "expectedQuantity" = t.q::numeric FROM unnest($1::uuid[], $2::text[]) AS t(i, q) WHERE d."id" = t.i`,
        chunk.map((n) => n.id),
        chunk.map((n) => n.expected),
      );
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

  /**
   * Seeing a transfer: either store. Changing, finalising or cancelling it (audit 1, 28 October
   * 2026): only its own store, so the receiving store cannot send or undo the sender's stock.
   */
  private assertDocAccess(doc: StockDocument, user: CurrentUser, use: 'see' | 'change' = 'see') {
    if (user.allStores) return;
    const ok = user.stores.some((s) => s.id === doc.storeId || (use === 'see' && s.id === doc.toStoreId));
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
    // In bulk (plan 11 A5): a count can list a whole shop.
    const items = await this.items.assertItemsUsable(db, lines.map((l) => l.itemId), 'stock');
    const units = new Map((await db.unit.findMany({ where: { id: { in: [...new Set([...items.values()].map((i) => i.baseUnitId))] } } })).map((u) => [u.id, u]));
    for (const [i, l] of lines.entries()) {
      const item = items.get(l.itemId)!;
      const unit = units.get(item.baseUnitId)!;
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
    // Audit 3 (28 October 2026): a count of today keeps the moment the shelf was counted; the sales
    // after it are replayed on top. That is not back-dating a document, so the count right is enough.
    if (doc.kind === 'count' && iso(doc.postingDate) === businessDate()) {
      doc.isBackDated = true;
      return;
    }
    if (!hasPermission(user, 'stock.backdate')) {
      throw new ForbiddenException('Later movements of these items exist; only the Accountant may post an earlier date');
    }
    if (iso(doc.postingDate)!.slice(0, 7) !== businessDate().slice(0, 7)) {
      throw new ForbiddenException('Back-dated stock entries are allowed only within the current month');
    }
    doc.isBackDated = true;
  }

  // ---- Batches and serials ----

  /** Finds or creates a batch (automatic number when none is given); used by purchasing too. */
  async ensureBatch(tx: Db, itemId: string, batchNumber: string | null, manufactureOn: string | null, expiryOn: string | null, actor: Actor) {
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
    if (doc.kind === 'count' && mode === 'cancel') return this.undoCountSerials(tx, doc, actor);
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
        // Audit 3 (28 October 2026): each serial must still be where this document put it (a phone sold
        // since cannot be brought back by cancelling the document that brought it in).
        const still = 'was moved or sold since; it cannot be put back';
        switch (doc.kind) {
          case 'stock_in':
            await expect('in_stock', doc.toLocationId, still);
            await set({ status: 'out', locationId: null, outDocumentId: doc.id });
            break;
          case 'stock_out': {
            const rows = await find();
            const bad = serials.filter((s) => !rows.some((r) => r.serial === s && r.status === 'out' && r.outDocumentId === doc.id));
            if (bad.length) throw new BadRequestException(`${l.item.code}: serial ${bad.join(', ')} ${still}`);
            await set({ status: 'in_stock', locationId: doc.fromLocationId, outDocumentId: null });
            break;
          }
          case 'move':
            await expect('in_stock', doc.toLocationId, still);
            await set({ locationId: doc.fromLocationId });
            break;
          case 'transfer_send':
            await expect('in_transit', null, still);
            await set({ status: 'in_stock', locationId: doc.fromLocationId });
            break;
          case 'transfer_receive':
            await expect('in_stock', doc.toLocationId, still);
            await set({ status: 'in_transit', locationId: doc.fromLocationId });
            break;
        }
      }
    }
  }

  /** Serial counts: the listed serials are the full set at the location; missing ones go out, new ones come in. */
  /** Audit 3 (28 October 2026): cancelling a count undoes what it did to serials, where they are still as it left them. */
  private async undoCountSerials(tx: Db, doc: DocumentRow, actor: Actor) {
    for (const l of doc.lines) {
      if (!l.item.trackSerials) continue;
      // Marked missing by the count: back on the shelf.
      await tx.serialNumber.updateMany({ where: { itemId: l.itemId, status: 'out', outDocumentId: doc.id }, data: { status: 'in_stock', locationId: doc.toLocationId, outDocumentId: null, updatedById: actor.userId } });
      // Found by the count and still on that shelf: gone again.
      await tx.serialNumber.updateMany({ where: { itemId: l.itemId, status: 'in_stock', locationId: doc.toLocationId, inDocumentId: doc.id }, data: { status: 'out', locationId: null, updatedById: actor.userId } });
    }
  }

  private async applyCountSerials(tx: Db, doc: DocumentRow, actor: Actor) {
    for (const l of doc.lines) {
      if (!l.item.trackSerials) continue;
      const listed = new Set(l.serialNumbers);
      // Audit 3 (28 October 2026): a serial recorded at another shelf or store, or on its way in a
      // transfer, is moved or received there first; a count never pulls it here silently.
      const elsewhere = await tx.serialNumber.findMany({ where: { itemId: l.itemId, serial: { in: [...listed] }, OR: [{ status: 'in_transit' }, { status: 'in_stock', locationId: { not: doc.toLocationId } }] }, select: { serial: true, status: true } });
      if (elsewhere.length) {
        throw new BadRequestException(`${l.item.code}: serial ${elsewhere.map((s) => s.serial).join(', ')} is recorded ${elsewhere.some((s) => s.status === 'in_transit') ? 'on its way in a transfer' : 'at another place'}; move or receive it there first`);
      }
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
    // In bulk (plan 11 A5): a count can have tens of thousands of lines.
    const rows = [...byLine];
    for (let i = 0; i < rows.length; i += 5000) {
      const chunk = rows.slice(i, i + 5000);
      await tx.$executeRawUnsafe(
        `UPDATE "StockDocumentLine" d SET "valueChange" = t.v::numeric FROM unnest($1::uuid[], $2::text[]) AS t(i, v) WHERE d."id" = t.i`,
        chunk.map(([id]) => id),
        chunk.map(([, value]) => value.toFixed(2)),
      );
    }
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
