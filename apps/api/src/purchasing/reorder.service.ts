// Copyright (c) 2026, Rademics. All rights reserved.
// Reorder suggestions (plan 05 §1 item 7, answer 5): items below their reorder
// level per store become suggestions; ticked ones become draft purchase
// orders, one per supplier and store. Runs nightly on the Indian date (rule 15).
import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { businessDate, type CreateOrdersFromSuggestionsInput, type CurrentUser, Decimal, INDIA_TIME_ZONE, reorderSuggestion } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { forEachShop } from '../prisma/each-shop.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';
import { defaultNeededBy, PurchaseOrdersService } from './purchase-orders.service.js';
import { catchUpAtStart } from '../common/nightly-catch-up.js';

/** Orders that still bring goods (drafts too, so a suggestion turned into a draft is not suggested again). */
const ON_ORDER_STATUSES = ['draft', 'to_receive_and_bill', 'to_receive', 'on_hold'] as const;

@Injectable()
export class ReorderService implements OnApplicationBootstrap {
  private readonly log = new Logger(ReorderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly audit: AuditService,
    private readonly common: PurchaseCommon,
    private readonly orders: PurchaseOrdersService,
  ) {}

  async list(storeId: string | undefined, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const rows = await this.prisma.reorderSuggestion.findMany({
      where: { companyId: company.id, status: 'open', ...(storeId ? { storeId } : {}), ...(stores ? { storeId: { in: stores } } : {}) },
      orderBy: [{ storeId: 'asc' }, { createdAt: 'asc' }],
    });
    const items = await this.prisma.item.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, code: true, name: true, baseUnitId: true, preferredSupplierId: true } });
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } });
    const storeRows = await this.prisma.store.findMany({ where: { id: { in: rows.map((r) => r.storeId) } }, select: { id: true, code: true, name: true } });
    const by = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const itemMap = by(items);
    const supplierMap = by(suppliers);
    const storeMap = by(storeRows);
    return rows.map((r) => ({
      id: r.id,
      businessDate: iso(r.businessDate),
      store: storeMap.get(r.storeId) ?? null,
      item: itemMap.get(r.itemId) ?? null,
      supplier: r.supplierId ? (supplierMap.get(r.supplierId) ?? null) : null,
      /** "usual" when set on the item; "last" when it is the supplier it was last bought from. */
      supplierSource: r.supplierId ? (itemMap.get(r.itemId)?.preferredSupplierId === r.supplierId ? 'usual' : 'last') : null,
      onHand: r.onHand.toString(),
      onOrder: r.onOrder.toString(),
      reorderLevel: r.reorderLevel.toString(),
      reorderQuantity: r.reorderQuantity.toString(),
      suggestedQuantity: r.suggestedQuantity.toString(),
    }));
  }

  onApplicationBootstrap(): void {
    catchUpAtStart(this.log, 'Nightly reorder run', () => this.nightly());
  }

  @Cron('30 2 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    // Plan 14: shop by shop.
    await forEachShop(this.system, this.log, 'Nightly reorder run', async () => {
      try {
        for (const c of await this.prisma.company.findMany({ where: { active: true }, select: { id: true } })) {
          const n = await this.run(c.id, businessDate(), { userId: null, ipAddress: null });
          if (n) this.log.log(`${n} reorder suggestion(s) for ${businessDate()}`);
        }
      } catch (err) {
        this.log.error('Nightly reorder run failed', err instanceof Error ? err.stack : String(err));
      }
    });
  }

  async runNow(actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const company = await this.common.currentCompany();
    const count = await this.run(company.id, businessDate(), actor);
    return { suggestions: count };
  }

  /** Replaces the open suggestions with fresh ones (ordered or dismissed ones stay as history). */
  async run(companyId: string, today: string, actor: Actor): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const levels = await tx.reorderLevel.findMany({ where: { active: true, requestType: 'buy', level: { gt: 0 } } });
      const stores = new Map((await tx.store.findMany({ where: { companyId, active: true } })).map((s) => [s.id, s]));
      await tx.reorderSuggestion.deleteMany({ where: { companyId, status: 'open' } });
      let count = 0;
      for (const level of levels) {
        if (!stores.has(level.storeId)) continue;
        const item = await tx.item.findUnique({ where: { id: level.itemId } });
        if (!item || !item.active || !item.canBuy || !item.isStockItem || item.isParentStyle) continue;
        const onHand = await this.onHand(tx, level.itemId, level.storeId);
        const onOrder = await this.onOrder(tx, level.itemId, level.storeId);
        const qty = reorderSuggestion({ onHand, onOrder, level: level.level.toString(), reorderQuantity: level.quantity.toString() });
        if (!qty) continue;
        await tx.reorderSuggestion.create({
          data: {
            companyId,
            storeId: level.storeId,
            itemId: level.itemId,
            // Launch check, 27 October 2026: with no usual supplier set, the one it was last bought from.
            supplierId: item.preferredSupplierId ?? (await this.lastSupplier(tx, level.itemId)),
            onHand: onHand.toString(),
            onOrder: onOrder.toString(),
            reorderLevel: level.level.toString(),
            reorderQuantity: level.quantity.toString(),
            suggestedQuantity: qty.toString(),
            businessDate: fromIso(today),
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        count++;
      }
      return count;
    });
  }

  /** Stock that can be sold: shelf locations of the store (not Rejected, not transit). */
  private async onHand(tx: Db, itemId: string, storeId: string): Promise<Decimal> {
    const shelves = await tx.stockLocation.findMany({ where: { storeId, kind: 'shelf' }, select: { id: true } });
    const sum = await tx.stockPosition.aggregate({ where: { itemId, locationId: { in: shelves.map((l) => l.id) } }, _sum: { quantity: true } });
    // Audit 3 (28 October 2026): goods already on their way to this store from another count too,
    // so a transfer in transit is not bought again.
    const coming = await tx.stockDocumentLine.findMany({ where: { itemId, document: { kind: 'transfer_send', status: 'finalised', toStoreId: storeId } }, select: { basicQuantity: true, receivedQuantity: true } });
    const onTheWay = coming.reduce((s, l) => s.add(Decimal.max(0, D(l.basicQuantity).sub(D(l.receivedQuantity)))), new Decimal(0));
    return D(sum._sum.quantity ?? '0').add(onTheWay);
  }

  /** The supplier of the latest goods received for the item (not a return, not a draft or cancelled one). */
  private async lastSupplier(tx: Db, itemId: string): Promise<string | null> {
    const line = await tx.goodsReceiptLine.findFirst({
      where: { itemId, receipt: { isReturn: false, status: { notIn: ['draft', 'cancelled'] } } },
      orderBy: [{ receipt: { postingDate: 'desc' } }, { receipt: { createdAt: 'desc' } }],
      select: { receipt: { select: { supplierId: true } } },
    });
    return line?.receipt.supplierId ?? null;
  }

  private async onOrder(tx: Db, itemId: string, storeId: string): Promise<Decimal> {
    const lines = await tx.purchaseOrderLine.findMany({ where: { itemId, storeId, order: { status: { in: [...ON_ORDER_STATUSES] } } }, select: { basicQuantity: true, receivedQuantity: true } });
    return lines.reduce((s, l) => s.add(Decimal.max(0, D(l.basicQuantity).sub(D(l.receivedQuantity)))), new Decimal(0));
  }

  /** One draft order per supplier and store; the suggestions are marked ordered. */
  async createOrders(input: CreateOrdersFromSuggestionsInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const company = await this.common.currentCompany();
    const suggestions = await this.prisma.reorderSuggestion.findMany({ where: { id: { in: input.suggestionIds }, companyId: company.id } });
    if (suggestions.length !== new Set(input.suggestionIds).size) throw new BadRequestException('Suggestion not found');
    for (const s of suggestions) {
      if (s.status !== 'open') throw new BadRequestException('A suggestion was already ordered or dismissed; refresh the list');
      if (!s.supplierId) {
        const item = await this.prisma.item.findUniqueOrThrow({ where: { id: s.itemId } });
        throw new BadRequestException(`${item.code} has no usual supplier; set one on the item or order it by hand`);
      }
    }
    const groups = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      const key = `${s.supplierId}|${s.storeId}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const orderDate = businessDate();
    const neededBy = input.neededBy ?? defaultNeededBy();
    const created: string[] = [];
    for (const group of groups.values()) {
      const first = group[0];
      const orderInput = {
        supplierId: first.supplierId!,
        orderDate,
        neededBy,
        storeId: first.storeId,
        remarks: 'Made from reorder suggestions',
        lines: await Promise.all(group.map(async (s) => ({ itemId: s.itemId, unitId: (await this.prisma.item.findUniqueOrThrow({ where: { id: s.itemId } })).baseUnitId, quantity: s.suggestedQuantity.toString() }))),
      };
      const prepared = await this.orders.prepare(this.prisma, company.id, orderInput, user);
      const order = await this.prisma.$transaction(async (tx) => {
        const o = await this.orders.createDraft(tx, company.id, orderInput, prepared, actor);
        for (const [i, s] of group.entries()) await tx.reorderSuggestion.update({ where: { id: s.id }, data: { status: 'ordered', orderLineId: o.lines[i].id, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'purchase_order', entityId: o.id, changes: { number: o.number, fromSuggestions: group.length } });
        return o;
      });
      created.push(order.id);
    }
    return { orderIds: created };
  }
}
