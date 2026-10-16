// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C4 (owner decision of 16 October 2026): season sell-through. Per
// season (or per style, group or item of one season): what came in on goods
// receipts (bills that receive goods make a receipt too; returns to the
// supplier take it off), what the tills sold net of returns, what is in stock
// now, and the share sold. All quantities are in basic units, read from the
// stock records, so they agree with the stock reports. A variant without its
// own season takes its style's.
import { Injectable } from '@nestjs/common';
import { type CurrentUser, Decimal } from 'shared';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, qty, ReportsCommon, ZERO } from './reports-common.service.js';

export const seasonSellThroughQuerySchema = z.object({
  seasonId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  groupBy: z.enum(['season', 'style', 'group', 'item']).optional(),
});
export type SeasonSellThroughQuery = z.infer<typeof seasonSellThroughQuerySchema>;

interface Row {
  itemId: string;
  styleId: string;
  itemGroupId: string;
  seasonId: string;
  bought: Prisma.Decimal;
  sold: Prisma.Decimal;
  inStock: Prisma.Decimal;
}

interface Sums {
  bought: Decimal;
  sold: Decimal;
  inStock: Decimal;
}

/** Share sold of what the shop has had: sold ÷ (sold + still in stock), as a percentage; null when there was nothing. */
export function percentSold(sold: Decimal, inStock: Decimal): string | null {
  const had = sold.add(Decimal.max(inStock, 0));
  return had.lte(0) ? null : sold.div(had).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

@Injectable()
export class SeasonReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
  ) {}

  async sellThrough(q: SeasonSellThroughQuery, user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const scope = this.common.scope(user, q.storeId);
    const by = q.groupBy ?? (q.seasonId ? 'style' : 'season');
    const locations = scope.ids
      ? scope.ids.length
        ? Prisma.sql`AND "storeId" IN (${Prisma.join(scope.ids.map((s) => Prisma.sql`${s}::uuid`))})`
        : Prisma.sql`AND false`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH it AS (
        SELECT i.id, COALESCE(i."parentItemId", i.id) AS "styleId", i."itemGroupId", COALESCE(i."seasonId", p."seasonId") AS "seasonId"
        FROM "Item" i LEFT JOIN "Item" p ON p.id = i."parentItemId"
        WHERE i."isParentStyle" = false
      ),
      loc AS (SELECT id FROM "StockLocation" WHERE "companyId" = ${company.id}::uuid ${locations})
      SELECT it.id AS "itemId", it."styleId", it."itemGroupId", it."seasonId",
        COALESCE((SELECT SUM(e."quantityChange") FROM "StockLedgerEntry" e WHERE e."itemId" = it.id AND e."documentType" = 'goods_receipt' AND e."locationId" IN (SELECT id FROM loc)), 0) AS bought,
        COALESCE((SELECT -SUM(e."quantityChange") FROM "StockLedgerEntry" e WHERE e."itemId" = it.id AND e."documentType" = 'pos_bill' AND e."locationId" IN (SELECT id FROM loc)), 0) AS sold,
        COALESCE((SELECT SUM(s.quantity) FROM "StockPosition" s WHERE s."itemId" = it.id AND s."locationId" IN (SELECT id FROM loc)), 0) AS "inStock"
      FROM it
      WHERE it."seasonId" IN (SELECT id FROM "Season" WHERE "companyId" = ${company.id}::uuid)
        ${q.seasonId ? Prisma.sql`AND it."seasonId" = ${q.seasonId}::uuid` : Prisma.empty}`;

    const keyOf = (r: Row) => (by === 'season' ? r.seasonId : by === 'style' ? r.styleId : by === 'group' ? r.itemGroupId : r.itemId);
    const groups = new Map<string, Sums>();
    const total: Sums = { bought: ZERO, sold: ZERO, inStock: ZERO };
    for (const r of rows) {
      const k = keyOf(r);
      const g = groups.get(k) ?? { bought: ZERO, sold: ZERO, inStock: ZERO };
      for (const f of ['bought', 'sold', 'inStock'] as const) {
        g[f] = g[f].add(D(r[f]));
        total[f] = total[f].add(D(r[f]));
      }
      groups.set(k, g);
    }
    const names = await this.names(by, [...groups.keys()]);
    const out = [...groups.entries()]
      .map(([k, g]) => ({ key: k, ...names(k), ...this.dto(g) }))
      .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
    const season = q.seasonId ? await this.prisma.season.findUnique({ where: { id: q.seasonId }, select: { id: true, code: true, name: true } }) : null;
    return { season, groupBy: by, workedOutAt: new Date().toISOString(), rows: out, totals: this.dto(total) };
  }

  private dto(s: Sums) {
    return { bought: qty(s.bought), sold: qty(s.sold), inStock: qty(s.inStock), percentSold: percentSold(s.sold, s.inStock) };
  }

  private async names(by: string, keys: string[]): Promise<(k: string) => { code: string | null; name: string }> {
    if (by === 'season') {
      const m = new Map((await this.prisma.season.findMany({ where: { id: { in: keys } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'group') {
      const m = await this.common.groups(keys);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    const m = await this.common.items(keys);
    return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
  }
}
