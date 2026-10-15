// Copyright (c) 2026, Rademics. All rights reserved.
// Stock balance, history, batches, negative-stock exceptions, quick lookup.
import { Injectable } from '@nestjs/common';
import { addDays, businessDate, type CurrentUser, Decimal, endOfBusinessDay, hasPermission, type StockBalanceQuery, type StockLedgerQuery } from 'shared';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import { CompanyService } from '../company/company.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ItemsService } from '../items/items.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

interface BalanceRow {
  itemId: string;
  locationId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  value: Prisma.Decimal;
}

@Injectable()
export class StockReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: CompanyService,
    private readonly items: ItemsService,
  ) {}

  /** Locations the user may see (their stores' locations plus transit). */
  private async visibleLocations(user: CurrentUser, q: { storeId?: string; locationId?: string }) {
    const company = await this.company.current();
    if (q.storeId) assertStoreAccess(user, q.storeId);
    const ids = allowedStoreIds(user);
    const locations = await this.prisma.stockLocation.findMany({
      where: {
        companyId: company.id,
        ...(q.locationId ? { id: q.locationId } : {}),
        ...(q.storeId ? { storeId: q.storeId } : ids ? { OR: [{ storeId: { in: ids } }, { kind: 'transit' }] } : {}),
      },
      include: { store: { select: { id: true, code: true, name: true } } },
    });
    return locations;
  }

  /** Per item × location; `asOf` reads the ledger at the end of that Indian day. */
  async balance(q: StockBalanceQuery, user: CurrentUser) {
    const showCost = hasPermission(user, 'stock.cost.view');
    const locations = await this.visibleLocations(user, q);
    const locIds = locations.map((l) => l.id);
    if (!locIds.length) return { rows: [], totals: showCost ? { value: '0.00' } : {} };
    let rows: BalanceRow[];
    if (q.asOf) {
      const until = endOfBusinessDay(q.asOf);
      rows = await this.prisma.$queryRaw<BalanceRow[]>`
        SELECT DISTINCT ON ("itemId", "locationId") "itemId", "locationId", "quantityAfter" AS quantity, "unitCostAfter" AS "unitCost", "valueAfter" AS value
        FROM "StockLedgerEntry"
        WHERE "locationId" IN (${Prisma.join(locIds.map((id) => Prisma.sql`${id}::uuid`))}) AND "postingAt" < ${until}
          ${q.itemId ? Prisma.sql`AND "itemId" = ${q.itemId}::uuid` : Prisma.empty}
        ORDER BY "itemId", "locationId", "postingAt" DESC, "id" DESC`;
    } else {
      rows = await this.prisma.stockPosition.findMany({ where: { locationId: { in: locIds }, ...(q.itemId ? { itemId: q.itemId } : {}) } });
    }
    if (q.includeZero !== 'true') rows = rows.filter((r) => !new Decimal(r.quantity.toString()).isZero() || !new Decimal(r.value.toString()).isZero());
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    // A group filter includes every group below it in the tree.
    const group = q.groupId ? await this.prisma.itemGroup.findUnique({ where: { id: q.groupId } }) : null;
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds }, ...(q.groupId ? { itemGroup: { path: { startsWith: group?.path ?? '//none' } } } : {}) },
      select: { id: true, code: true, name: true, itemGroupId: true, baseUnit: { select: { code: true } } },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const locMap = new Map(locations.map((l) => [l.id, l]));
    let total = new Decimal(0);
    const out = rows
      .filter((r) => itemMap.has(r.itemId))
      .map((r) => {
        const item = itemMap.get(r.itemId)!;
        const loc = locMap.get(r.locationId)!;
        total = total.add(r.value.toString());
        return {
          item: { id: item.id, code: item.code, name: item.name, unit: item.baseUnit.code },
          location: { id: loc.id, code: loc.code, name: loc.name, kind: loc.kind, store: loc.store },
          quantity: r.quantity.toString(),
          ...(showCost ? { unitCost: new Decimal(r.unitCost.toString()).toFixed(4), value: new Decimal(r.value.toString()).toFixed(2) } : {}),
        };
      })
      .sort((a, b) => (a.item.code + a.location.code).localeCompare(b.item.code + b.location.code));
    return { rows: out, totals: showCost ? { value: total.toFixed(2) } : {} };
  }

  async ledger(q: StockLedgerQuery, user: CurrentUser) {
    const showCost = hasPermission(user, 'stock.cost.view');
    const locations = await this.visibleLocations(user, q);
    const entries = await this.prisma.stockLedgerEntry.findMany({
      where: {
        locationId: { in: locations.map((l) => l.id) },
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.batchId ? { batchId: q.batchId } : {}),
        ...(q.from || q.to ? { postingDate: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } } : {}),
      },
      orderBy: [{ postingAt: 'desc' }, { id: 'desc' }],
      take: q.limit ?? 200,
    });
    const idsOf = (type: string) => [...new Set(entries.filter((e) => e.documentType === type).map((e) => e.documentId))];
    const docs = await this.prisma.stockDocument.findMany({ where: { id: { in: idsOf('stock_document') } }, select: { id: true, number: true, kind: true, reason: true } });
    // Module 5: goods receipts (and returns) and extra-charge entries post to the same ledger.
    const receipts = await this.prisma.goodsReceipt.findMany({ where: { id: { in: idsOf('goods_receipt') } }, select: { id: true, number: true, isReturn: true } });
    const charges = await this.prisma.landedCharge.findMany({ where: { id: { in: idsOf('landed_charge') } }, select: { id: true, number: true } });
    // Module 6: till bills reduce stock at once (decision 39).
    const tillBills = await this.prisma.posBill.findMany({ where: { id: { in: idsOf('pos_bill') } }, select: { id: true, number: true, kind: true } });
    const items = await this.prisma.item.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.itemId))] } }, select: { id: true, code: true, name: true } });
    const docMap = new Map<string, { id: string; number: string; kind: string; reason: string | null }>([
      ...docs.map((d) => [d.id, d] as const),
      ...receipts.map((r) => [r.id, { id: r.id, number: r.number, kind: r.isReturn ? 'purchase_return' : 'goods_receipt', reason: null }] as const),
      ...charges.map((c) => [c.id, { id: c.id, number: c.number, kind: 'landed_charge', reason: null }] as const),
      ...tillBills.map((b) => [b.id, { id: b.id, number: b.number, kind: b.kind === 'sale' ? 'pos_sale' : 'pos_return', reason: null }] as const),
    ]);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return entries.map((e) => ({
      id: e.id.toString(),
      postingDate: iso(e.postingDate),
      postingAt: e.postingAt,
      document: docMap.get(e.documentId) ?? null,
      item: itemMap.get(e.itemId) ?? null,
      location: { id: e.locationId, name: locMap.get(e.locationId)?.name, store: locMap.get(e.locationId)?.store?.code ?? null },
      batchId: e.batchId,
      quantityChange: e.quantityChange.toString(),
      quantityAfter: e.quantityAfter.toString(),
      isCancellation: e.isCancellation,
      wentNegative: e.wentNegative,
      ...(showCost
        ? { unitCost: e.unitCost.toFixed(4), valueChange: e.valueChange.toFixed(2), unitCostAfter: e.unitCostAfter.toFixed(4), valueAfter: e.valueAfter.toFixed(2), accountRole: e.accountRole }
        : {}),
    }));
  }

  /** Quick lookup: scan an item, see quantity per location (decision 70: no values for cashiers). */
  async lookup(code: string, user: CurrentUser) {
    const scan = await this.items.scan(code, user);
    const locations = await this.visibleLocations(user, {});
    const positions = await this.prisma.stockPosition.findMany({ where: { itemId: scan.item.id, locationId: { in: locations.map((l) => l.id) } } });
    const showCost = hasPermission(user, 'stock.cost.view');
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return {
      item: { id: scan.item.id, code: scan.item.code, name: scan.item.name, unit: scan.item.baseUnit.code },
      usable: scan.usable,
      reason: scan.reason,
      locations: positions
        .filter((p) => !p.quantity.isZero())
        .map((p) => ({
          location: { id: p.locationId, name: locMap.get(p.locationId)?.name, store: locMap.get(p.locationId)?.store?.code ?? null },
          quantity: p.quantity.toString(),
          ...(showCost ? { value: p.value.toString() } : {}),
        })),
    };
  }

  async batches(itemId: string | undefined, expiringWithinDays: number | undefined, user: CurrentUser) {
    const locations = await this.visibleLocations(user, {});
    const today = businessDate();
    const until = expiringWithinDays !== undefined ? addDays(today, expiringWithinDays) : null;
    const positions = await this.prisma.batchPosition.findMany({
      where: {
        locationId: { in: locations.map((l) => l.id) },
        NOT: { quantity: 0 },
        batch: { ...(itemId ? { itemId } : {}), ...(until ? { expiryDate: { lte: new Date(`${until}T00:00:00Z`) } } : {}) },
      },
      include: { batch: { include: { item: { select: { id: true, code: true, name: true } } } } },
    });
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return positions
      .map((p) => {
        const expiry = iso(p.batch.expiryDate);
        const daysLeft = expiry ? Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
        return {
          batch: { id: p.batch.id, batchNumber: p.batch.batchNumber, expiryDate: expiry, manufactureDate: iso(p.batch.manufactureDate) },
          item: p.batch.item,
          location: { id: p.locationId, name: locMap.get(p.locationId)?.name, store: locMap.get(p.locationId)?.store?.code ?? null },
          quantity: p.quantity.toString(),
          daysLeft,
          expired: daysLeft !== null && daysLeft < 0,
        };
      })
      .sort((a, b) => (a.batch.expiryDate ?? '9999').localeCompare(b.batch.expiryDate ?? '9999'));
  }

  /** Decision 32: every negative balance appears daily for the manager to resolve. */
  async negativeExceptions(user: CurrentUser) {
    const locations = await this.visibleLocations(user, {});
    const positions = await this.prisma.stockPosition.findMany({ where: { locationId: { in: locations.map((l) => l.id) }, quantity: { lt: 0 } } });
    const items = await this.prisma.item.findMany({ where: { id: { in: positions.map((p) => p.itemId) } }, select: { id: true, code: true, name: true } });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return positions.map((p) => ({
      item: itemMap.get(p.itemId),
      location: { id: p.locationId, name: locMap.get(p.locationId)?.name, store: locMap.get(p.locationId)?.store?.code ?? null },
      quantity: p.quantity.toString(),
      since: p.lastPostingAt,
    }));
  }

  /** Rule 6 check: every position equals the sum of its ledger lines (used by tests and an admin check). */
  async consistencyProblems(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ itemId: string; locationId: string; pq: Prisma.Decimal; pv: Prisma.Decimal; lq: Prisma.Decimal | null; lv: Prisma.Decimal | null }[]>`
      SELECT p."itemId", p."locationId", p.quantity AS pq, p.value AS pv, sum(e."quantityChange") AS lq, sum(e."valueChange") AS lv
      FROM "StockPosition" p LEFT JOIN "StockLedgerEntry" e ON e."itemId" = p."itemId" AND e."locationId" = p."locationId"
      GROUP BY p."itemId", p."locationId", p.quantity, p.value`;
    const problems: string[] = [];
    for (const r of rows) {
      const lq = new Decimal((r.lq ?? 0).toString());
      const lv = new Decimal((r.lv ?? 0).toString());
      if (!lq.eq(r.pq.toString()) || !lv.eq(r.pv.toString())) {
        problems.push(`${r.itemId}@${r.locationId}: position ${r.pq.toString()}/${r.pv.toString()}, ledger ${lq.toString()}/${lv.toString()}`);
      }
    }
    const batches = await this.prisma.$queryRaw<{ batchId: string; locationId: string; q: Prisma.Decimal; lq: Prisma.Decimal | null }[]>`
      SELECT b."batchId", b."locationId", b.quantity AS q, sum(e."quantityChange") AS lq
      FROM "BatchPosition" b LEFT JOIN "StockLedgerEntry" e ON e."batchId" = b."batchId" AND e."locationId" = b."locationId"
      GROUP BY b."batchId", b."locationId", b.quantity`;
    for (const b of batches) {
      const lq = new Decimal((b.lq ?? 0).toString());
      if (!lq.eq(b.q.toString())) problems.push(`batch ${b.batchId}@${b.locationId}: ${b.q.toString()} vs ledger ${lq.toString()}`);
    }
    return problems;
  }
}
