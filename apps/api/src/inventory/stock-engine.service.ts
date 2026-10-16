// Copyright (c) 2026, Rademics. All rights reserved.
// The only code that writes stock ledger entries and positions (rules 5–7).
// Every caller passes its own transaction, so the document, its stock lines
// and its ledger entries succeed or fail together. Every change of stock value
// (new movements and re-costing of later ones) is posted to the ledger here.
import { BadRequestException, Injectable } from '@nestjs/common';
import { apply, Decimal, EMPTY_STATE, QUANTITY_TOLERANCE, type StockIntent, type StockState } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { Prisma, StockLedgerEntry } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';

export type EntryKind = 'in' | 'out' | 'set' | 'reverse';

export interface Movement {
  companyId: string;
  /** stock_document (default), goods_receipt or landed_charge. */
  documentType?: string;
  documentId: string;
  documentLineId: string;
  itemId: string;
  locationId: string;
  batchId?: string | null;
  postingDate: string;
  postingAt: Date;
  kind: EntryKind;
  /** in/out: quantity in basic units (> 0); set: the counted quantity. */
  quantity?: string;
  incomingCost?: string | null;
  targetCost?: string | null;
  /** The cost comes from another entry: an existing id, or an earlier movement in this call. */
  costSourceId?: bigint | null;
  costSourceIndex?: number;
  reversesId?: bigint;
  accountRole: string;
  isCancellation?: boolean;
  /** held: the document posts this value itself (goods receipts) or later (till sales at shift close). */
  ledger?: 'auto' | 'held';
}

export interface PostOptions {
  /** Decision 32: only the till may go below zero. */
  allowNegative: boolean;
  actorId: string | null;
  /** Item names for messages. */
  describe?: (itemId: string, locationId: string) => string;
  /** Directly revalued entries post against this role (freight added later), not their own. */
  counterRole?: string;
  ledgerRemark?: string;
}

type DbDecimal = Prisma.Decimal;
const D = (v: DbDecimal | Decimal | string | number) => new Decimal(v.toString());

const ORDER = [{ postingAt: 'asc' as const }, { id: 'asc' as const }];

@Injectable()
export class StockEngine {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * Writes the movements in order and returns the created entries in the same
   * order. Positions of every item × location touched are locked first.
   */
  async post(tx: Db, movements: Movement[], opts: PostOptions): Promise<StockLedgerEntry[]> {
    if (movements.length === 0) return [];
    await this.lockPositions(tx, movements);
    await tx.$executeRaw`SELECT set_config('app.stock_recost', 'on', true)`;

    const created: StockLedgerEntry[] = [];
    const touched = new Set<bigint>();
    for (const [index, m] of movements.entries()) {
      const costSourceId = m.costSourceIndex !== undefined ? created[m.costSourceIndex].id : (m.costSourceId ?? null);
      if (m.costSourceIndex !== undefined && m.costSourceIndex >= index) throw new Error('costSourceIndex must point at an earlier movement');
      const placeholder = new Decimal(0).toString();
      const entry = await tx.stockLedgerEntry.create({
        data: {
          companyId: m.companyId,
          itemId: m.itemId,
          locationId: m.locationId,
          batchId: m.batchId ?? null,
          documentType: m.documentType ?? 'stock_document',
          documentId: m.documentId,
          documentLineId: m.documentLineId,
          postingDate: new Date(`${m.postingDate}T00:00:00Z`),
          postingAt: m.postingAt,
          kind: m.kind,
          intentQuantity: m.quantity ?? '0',
          incomingCost: m.incomingCost ?? null,
          targetCost: m.targetCost ?? null,
          costSourceId,
          reversesId: m.reversesId ?? null,
          quantityChange: placeholder,
          valueChange: placeholder,
          unitCost: placeholder,
          quantityAfter: placeholder,
          unitCostAfter: placeholder,
          valueAfter: placeholder,
          accountRole: m.accountRole,
          isCancellation: m.isCancellation ?? false,
          ledgerHeld: m.ledger === 'held',
          createdById: opts.actorId,
        },
      });
      await this.recompute(tx, entry, opts, true, touched);
      created.push(await tx.stockLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } }));
    }
    await this.refreshBatchPositions(tx, movements, opts);
    const newIds = new Set(created.map((e) => e.id));
    await this.ledger.syncStock(tx, [...new Set([...newIds, ...touched])], { actorId: opts.actorId, newIds, remark: opts.ledgerRemark });
    return created;
  }

  /** Cancels a document: one reversing entry per original entry, at the original's time. */
  async reverseDocument(tx: Db, documentId: string, cancelDocumentLine: (e: StockLedgerEntry) => string, opts: PostOptions & { ledger?: 'auto' | 'held' }): Promise<StockLedgerEntry[]> {
    const originals = await tx.stockLedgerEntry.findMany({ where: { documentId, isCancellation: false }, orderBy: ORDER });
    const movements: Movement[] = originals.map((e) => ({
      companyId: e.companyId,
      documentType: e.documentType,
      documentId,
      documentLineId: cancelDocumentLine(e),
      itemId: e.itemId,
      locationId: e.locationId,
      batchId: e.batchId,
      postingDate: e.postingDate.toISOString().slice(0, 10),
      postingAt: e.postingAt,
      kind: 'reverse',
      reversesId: e.id,
      accountRole: e.accountRole,
      isCancellation: true,
      // A till sale still waiting for its shift close is undone the same way; otherwise the caller decides.
      ledger: opts.ledger ?? (e.ledgerHeld ? 'held' : 'auto'),
    }));
    // Undo in reverse order so a later leg (e.g. into transit) is undone before the leg it took its cost from.
    return this.post(tx, movements.reverse(), opts);
  }

  /**
   * Changes the incoming cost of finalised "in" entries (extra charges added to
   * goods already received, blueprint 07 process 7) and re-costs everything
   * after them, in the caller's transaction. Quantities never change here.
   */
  async revalueIncoming(tx: Db, changes: { entryId: bigint; incomingCost: string }[], opts: PostOptions): Promise<void> {
    if (changes.length === 0) return;
    const entries = await tx.stockLedgerEntry.findMany({ where: { id: { in: changes.map((c) => c.entryId) } } });
    if (entries.length !== changes.length) throw new BadRequestException('Stock entry not found');
    for (const e of entries) {
      if (e.kind !== 'in' || e.isCancellation) throw new BadRequestException('Only goods that came in can be revalued');
    }
    await this.lockPositions(tx, entries.map((e) => ({ itemId: e.itemId, locationId: e.locationId, companyId: e.companyId, batchId: e.batchId }) as Movement));
    await tx.$executeRaw`SELECT set_config('app.stock_recost', 'on', true)`;
    const touched = new Set<bigint>();
    for (const c of changes) {
      const updated = await tx.stockLedgerEntry.update({ where: { id: c.entryId }, data: { incomingCost: c.incomingCost } });
      await this.recompute(tx, updated, opts, false, touched);
      touched.add(c.entryId);
    }
    const counterRole = opts.counterRole ? new Map(changes.map((c) => [c.entryId, opts.counterRole!])) : undefined;
    await this.ledger.syncStock(tx, [...touched], { actorId: opts.actorId, counterRole, remark: opts.ledgerRemark });
  }

  // ---- internals ----

  private async lockPositions(tx: Db, movements: Movement[]): Promise<void> {
    const pairs = [...new Set(movements.map((m) => `${m.itemId}|${m.locationId}|${m.companyId}`))].sort();
    for (const p of pairs) {
      const [itemId, locationId, companyId] = p.split('|');
      await tx.$executeRaw`
        INSERT INTO "StockPosition" ("itemId", "locationId", "companyId", "updatedAt")
        VALUES (${itemId}::uuid, ${locationId}::uuid, ${companyId}::uuid, now())
        ON CONFLICT ("itemId", "locationId") DO NOTHING`;
    }
    // Fixed order (item, location) so two transactions never wait on each other in a circle.
    for (const p of pairs) {
      const [itemId, locationId] = p.split('|');
      await tx.$queryRaw`SELECT 1 FROM "StockPosition" WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid FOR UPDATE`;
    }
    const batchPairs = [...new Set(movements.filter((m) => m.batchId).map((m) => `${m.batchId}|${m.locationId}`))].sort();
    for (const p of batchPairs) {
      const [batchId, locationId] = p.split('|');
      await tx.$executeRaw`
        INSERT INTO "BatchPosition" ("batchId", "locationId", "updatedAt") VALUES (${batchId}::uuid, ${locationId}::uuid, now())
        ON CONFLICT ("batchId", "locationId") DO NOTHING`;
      await tx.$queryRaw`SELECT 1 FROM "BatchPosition" WHERE "batchId" = ${batchId}::uuid AND "locationId" = ${locationId}::uuid FOR UPDATE`;
    }
  }

  /**
   * Replays the ledger of one item × location from `from` onwards, rewriting
   * derived figures, updating the position, and cascading to entries that
   * take their cost from a changed entry (transfers and moves).
   */
  private async recompute(tx: Db, from: StockLedgerEntry, opts: PostOptions, isNewEntry: boolean, touched: Set<bigint>): Promise<void> {
    const queue: StockLedgerEntry[] = [from];
    let first = true;
    while (queue.length) {
      const start = queue.shift()!;
      const changedCostIds = await this.replayFrom(tx, start, opts, first && isNewEntry, touched);
      first = false;
      if (changedCostIds.length) {
        const dependents = await tx.stockLedgerEntry.findMany({ where: { costSourceId: { in: changedCostIds } }, orderBy: ORDER });
        for (const d of dependents) {
          await this.lockPositions(tx, [{ itemId: d.itemId, locationId: d.locationId, companyId: d.companyId, batchId: null } as Movement]);
          queue.push(d);
        }
      }
    }
  }

  private async replayFrom(tx: Db, start: StockLedgerEntry, opts: PostOptions, checkNegative: boolean, touched: Set<bigint>): Promise<bigint[]> {
    const { itemId, locationId } = start;
    const previous = await tx.stockLedgerEntry.findFirst({
      where: { itemId, locationId, OR: [{ postingAt: { lt: start.postingAt } }, { postingAt: start.postingAt, id: { lt: start.id } }] },
      orderBy: [{ postingAt: 'desc' }, { id: 'desc' }],
    });
    const entries = await tx.stockLedgerEntry.findMany({
      where: { itemId, locationId, OR: [{ postingAt: { gt: start.postingAt } }, { postingAt: start.postingAt, id: { gte: start.id } }] },
      orderBy: ORDER,
    });
    let state: StockState = previous
      ? { quantity: D(previous.quantityAfter), unitCost: D(previous.unitCostAfter), value: D(previous.valueAfter) }
      : EMPTY_STATE;
    const startQuantity = state.quantity;
    const fallback = await this.fallbackCost(tx, itemId, locationId);
    const changedCostIds: bigint[] = [];
    const recomputed = new Map<bigint, { quantityChange: Decimal; valueChange: Decimal; unitCost: Decimal }>();
    let oldMin = startQuantity;
    let newMin = startQuantity;
    // A cancelled document counts as never having happened for the negative-stock
    // check: an entry and its reversal are left out of the running minimum.
    const reversedLater = new Set(entries.filter((e) => e.kind === 'reverse' && e.reversesId !== null).map((e) => e.reversesId!));
    let pending = new Decimal(0);

    for (const e of entries) {
      const intent = await this.intentOf(tx, e, recomputed);
      let applied;
      try {
        applied = apply(state, intent, fallback);
      } catch (err) {
        if (err instanceof Error && err.message === 'MISSING_COST') {
          throw new BadRequestException(`No cost is known for ${opts.describe?.(itemId, locationId) ?? 'this item'}; record a stock-in with a cost first`);
        }
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
      if (e.id !== start.id || !checkNegative) oldMin = Decimal.min(oldMin, D(e.quantityAfter));
      if (reversedLater.has(e.id)) pending = pending.add(applied.quantityChange);
      if (e.kind === 'reverse' && e.reversesId !== null && reversedLater.has(e.reversesId) && recomputed.has(e.reversesId)) {
        pending = pending.sub(recomputed.get(e.reversesId)!.quantityChange);
      }
      newMin = Decimal.min(newMin, applied.after.quantity.sub(pending));
      recomputed.set(e.id, { quantityChange: applied.quantityChange, valueChange: applied.valueChange, unitCost: applied.unitCost });

      const changed =
        !D(e.quantityChange).eq(applied.quantityChange) ||
        !D(e.valueChange).eq(applied.valueChange) ||
        !D(e.unitCost).eq(applied.unitCost) ||
        !D(e.quantityAfter).eq(applied.after.quantity) ||
        !D(e.unitCostAfter).eq(applied.after.unitCost) ||
        !D(e.valueAfter).eq(applied.after.value);
      if (changed) {
        if (!D(e.unitCost).eq(applied.unitCost) || !D(e.valueChange).eq(applied.valueChange)) changedCostIds.push(e.id);
        if (!D(e.valueChange).eq(applied.valueChange)) touched.add(e.id);
        await tx.stockLedgerEntry.update({
          where: { id: e.id },
          data: {
            quantityChange: applied.quantityChange.toString(),
            valueChange: applied.valueChange.toFixed(2),
            unitCost: applied.unitCost.toFixed(4),
            quantityAfter: applied.after.quantity.toString(),
            unitCostAfter: applied.after.unitCost.toFixed(4),
            valueAfter: applied.after.value.toFixed(2),
            wentNegative: applied.after.quantity.lt(QUANTITY_TOLERANCE.neg()),
          },
        });
      }
      state = applied.after;
    }

    // Decision 32: in the back office a movement may not take stock below zero, now or at any later date.
    if (checkNegative && !opts.allowNegative && newMin.lt(QUANTITY_TOLERANCE.neg()) && newMin.lt(oldMin.sub(QUANTITY_TOLERANCE))) {
      const available = Decimal.max(new Decimal(0), startQuantity);
      const needed = newMin.neg();
      throw new BadRequestException(
        `Not enough stock of ${opts.describe?.(itemId, locationId) ?? 'this item'}: ${available.toString()} available, ${needed.toString()} more needed`,
      );
    }

    await tx.stockPosition.update({
      where: { itemId_locationId: { itemId, locationId } },
      data: {
        quantity: state.quantity.toString(),
        unitCost: state.unitCost.toFixed(4),
        value: state.value.toFixed(2),
        lastPostingAt: entries.length ? entries[entries.length - 1].postingAt : (previous?.postingAt ?? null),
      },
    });
    return changedCostIds;
  }

  private async intentOf(tx: Db, e: StockLedgerEntry, recomputed: Map<bigint, { quantityChange: Decimal; valueChange: Decimal; unitCost: Decimal }>): Promise<StockIntent> {
    const sourceCost = async (): Promise<Decimal | null> => {
      if (e.costSourceId === null) return null;
      const local = recomputed.get(e.costSourceId);
      if (local) return local.unitCost;
      const src = await tx.stockLedgerEntry.findUniqueOrThrow({ where: { id: e.costSourceId } });
      return D(src.unitCost);
    };
    switch (e.kind) {
      case 'in':
        return { kind: 'in', quantity: e.intentQuantity.toString(), incomingCost: ((await sourceCost()) ?? D(e.incomingCost ?? '0')).toString() };
      case 'out':
        return { kind: 'out', quantity: e.intentQuantity.toString(), fixedCost: (await sourceCost())?.toString() ?? null };
      case 'set':
        return { kind: 'set', targetQuantity: e.intentQuantity.toString(), targetCost: e.targetCost?.toString() ?? null };
      case 'reverse': {
        const local = e.reversesId !== null ? recomputed.get(e.reversesId) : undefined;
        if (local) return { kind: 'reverse', quantityChange: local.quantityChange.toString(), valueChange: local.valueChange.toString() };
        const orig = await tx.stockLedgerEntry.findUniqueOrThrow({ where: { id: e.reversesId! } });
        return { kind: 'reverse', quantityChange: orig.quantityChange.toString(), valueChange: orig.valueChange.toString() };
      }
    }
  }

  /** Last cost here → last cost anywhere in the company → last purchase price (blueprint 08). */
  private async fallbackCost(tx: Db, itemId: string, locationId: string): Promise<string | null> {
    const here = await tx.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
    if (here && D(here.unitCost).gt(0)) return here.unitCost.toString();
    const anywhere = await tx.stockPosition.findFirst({ where: { itemId, unitCost: { gt: 0 } }, orderBy: { lastPostingAt: 'desc' } });
    if (anywhere) return anywhere.unitCost.toString();
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { lastPurchasePrice: true } });
    return item?.lastPurchasePrice && D(item.lastPurchasePrice).gt(0) ? item.lastPurchasePrice.toString() : null;
  }

  /** Batch quantities are the sum of their ledger lines; refused below zero in the back office. */
  private async refreshBatchPositions(tx: Db, movements: Movement[], opts: PostOptions): Promise<void> {
    const pairs = [...new Set(movements.filter((m) => m.batchId).map((m) => `${m.batchId}|${m.locationId}|${m.itemId}`))];
    for (const p of pairs) {
      const [batchId, locationId, itemId] = p.split('|');
      const sum = await tx.stockLedgerEntry.aggregate({ where: { batchId, locationId }, _sum: { quantityChange: true } });
      const quantity = D(sum._sum.quantityChange ?? '0');
      if (!opts.allowNegative && quantity.lt(QUANTITY_TOLERANCE.neg())) {
        const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId } });
        throw new BadRequestException(
          `Not enough of batch ${batch.batchNumber} of ${opts.describe?.(itemId, locationId) ?? 'this item'}: ${quantity.neg().toString()} more needed`,
        );
      }
      await tx.batchPosition.update({ where: { batchId_locationId: { batchId, locationId } }, data: { quantity: quantity.toString() } });
    }
  }
}
