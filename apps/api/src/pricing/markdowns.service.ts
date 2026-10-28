// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C5 (owner decision of 16 October 2026): the markdown tool. Items are
// chosen by season, groups, brands or by hand; the new price is a percentage
// off the price before the markdown, or a fixed price, rounded to the rupee
// and never above the MRP. Applying adds dated prices to a selling list; the
// old prices stay, so before the start date (and after the end date, if any)
// the old price applies again. Styles are never priced: their sizes and
// colours are.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, businessDate, type CurrentUser, Decimal, hasPermission, type MarkdownInput, markdownPrice, type PriceCandidate, selectPrice } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { sortVariants } from '../items/items.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const date = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
const fromDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MAX_ITEMS = 5000;
const BATCH = 500;

export interface MarkdownLine {
  itemId: string;
  code: string;
  name: string;
  mrp: string | null;
  oldPrice: string | null;
  newPrice: string | null;
  cappedAtMrp: boolean;
  /** Why the item is left out, or null when it gets the new price. */
  skipped: string | null;
}

@Injectable()
export class MarkdownsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly settings: CatalogueSettingsService,
  ) {}

  /** What applying would do, item by item: old price, new price and the MRP check. Nothing is saved. */
  async preview(input: MarkdownInput, user: CurrentUser) {
    const { list, lines } = await this.work(input, user);
    return { priceList: { id: list.id, code: list.code, name: list.name }, ...this.counts(lines), lines };
  }

  /** Adds the dated prices in one go and records the markdown; all or nothing. */
  async apply(input: MarkdownInput, actor: Actor, user: CurrentUser) {
    const company = await this.company.current();
    const { list, lines } = await this.work(input, user);
    const chosen = lines.filter((l) => !l.skipped);
    if (!chosen.length) throw new BadRequestException('None of the chosen items can be marked down; see the preview for why');
    const startDate = fromDate(input.startDate);
    const endDate = input.endDate ? fromDate(input.endDate) : null;
    const items = new Map((await this.prisma.item.findMany({ where: { id: { in: chosen.map((l) => l.itemId) } }, select: { id: true, baseUnitId: true } })).map((i) => [i.id, i.baseUnitId]));
    const markdown = await this.prisma.$transaction(
      async (tx) => {
        const md = await tx.markdown.create({
          data: {
            companyId: company.id,
            priceListId: list.id,
            rule: input.rule,
            value: new Decimal(input.value),
            startDate,
            endDate,
            chosenBy: { seasonId: input.seasonId ?? null, itemGroupIds: input.itemGroupIds ?? [], brandIds: input.brandIds ?? [], itemIds: input.itemIds ?? [] },
            itemCount: chosen.length,
            remark: input.remark ?? null,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        for (let n = 0; n < chosen.length; n += BATCH) {
          const part = chosen.slice(n, n + BATCH);
          const created = await tx.price.createManyAndReturn({
            data: part.map((l) => ({
              priceListId: list.id,
              itemId: l.itemId,
              unitId: items.get(l.itemId)!,
              price: new Decimal(l.newPrice!),
              startDate,
              endDate,
              markdownId: md.id,
              createdById: actor.userId,
              updatedById: actor.userId,
            })),
            select: { id: true, itemId: true },
          });
          const byItem = new Map(part.map((l) => [l.itemId, l]));
          // Every price change is in the history with its old and new value (reliability rule 9).
          await tx.auditLog.createMany({
            data: created.map((p) => {
              const l = byItem.get(p.itemId)!;
              return {
                userId: actor.userId,
                ipAddress: actor.ipAddress,
                action: 'create',
                entityType: 'price',
                entityId: p.id,
                changes: { item: l.code, list: list.code, price: l.newPrice, oldPrice: l.oldPrice, startDate: input.startDate, endDate: input.endDate ?? null, markdown: md.id } as Prisma.InputJsonValue,
                reason: 'Markdown',
              };
            }),
          });
        }
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'markdown',
          entityId: md.id,
          changes: { list: list.code, rule: input.rule, value: input.value, startDate: input.startDate, endDate: input.endDate ?? null, items: chosen.length, chosenBy: md.chosenBy as Prisma.InputJsonValue },
          reason: input.remark ?? null,
        });
        return md;
      },
      { timeout: 60_000 },
    );
    return { ...(await this.get(markdown.id, user)), ...this.counts(lines) };
  }

  /**
   * Decision L3 (owner, 28 October 2026): a markdown made by mistake is withdrawn before it starts,
   * and a running one can be ended early. Its prices end the day before today (a price not started
   * yet ends the day before its own start, so it never applies): from today the price before the
   * markdown applies again. Nothing is deleted; every price change is in the history.
   */
  async stop(id: string, reason: string, actor: Actor, user: CurrentUser) {
    const company = await this.company.current();
    const today = businessDate();
    const yesterday = addDays(today, -1);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Markdown" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const md = await tx.markdown.findUnique({ where: { id } });
        if (!md || md.companyId !== company.id) throw new NotFoundException('Markdown not found');
        if (md.stoppedOn) throw new BadRequestException('This markdown was already stopped');
        const end = date(md.endDate);
        if (end && end < today) throw new BadRequestException('This markdown has already ended');
        const withdrawn = date(md.startDate)! >= today;
        const prices = await tx.price.findMany({ where: { markdownId: md.id }, select: { id: true, startDate: true, endDate: true, item: { select: { code: true } } } });
        const byEnd = new Map<string, typeof prices>();
        for (const p of prices) {
          const start = date(p.startDate)!;
          const newEnd = start > yesterday ? addDays(start, -1) : yesterday;
          const oldEnd = date(p.endDate);
          if (oldEnd !== null && oldEnd <= newEnd) continue;
          byEnd.set(newEnd, [...(byEnd.get(newEnd) ?? []), p]);
        }
        for (const [newEnd, group] of byEnd) {
          await tx.price.updateMany({ where: { id: { in: group.map((p) => p.id) } }, data: { endDate: fromDate(newEnd), updatedById: actor.userId } });
          await tx.auditLog.createMany({
            data: group.map((p) => ({
              userId: actor.userId,
              ipAddress: actor.ipAddress,
              action: 'update',
              entityType: 'price',
              entityId: p.id,
              changes: { item: p.item.code, endDate: { old: date(p.endDate), new: newEnd }, markdown: md.id } as Prisma.InputJsonValue,
              reason: withdrawn ? 'Markdown withdrawn' : 'Markdown ended early',
            })),
          });
        }
        await tx.markdown.update({ where: { id: md.id }, data: { stoppedOn: fromDate(today), stoppedById: actor.userId, stoppedReason: reason, updatedById: actor.userId } });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'markdown',
          entityId: md.id,
          changes: { status: { old: withdrawn ? 'upcoming' : 'running', new: withdrawn ? 'withdrawn' : 'ended' }, stoppedOn: today, prices: prices.length },
          reason,
        });
      },
      { timeout: 60_000 },
    );
    return this.get(id, user);
  }

  async list(user: CurrentUser) {
    const company = await this.company.current();
    const rows = await this.prisma.markdown.findMany({ where: { companyId: company.id }, orderBy: [{ createdAt: 'desc' }], take: 200 });
    const lists = new Map((await this.prisma.priceList.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.priceListId))] } }, select: { id: true, code: true, name: true } })).map((l) => [l.id, l]));
    const users = await this.users(rows.flatMap((r) => [r.createdById, r.stoppedById]));
    void user;
    return rows.map((r) => this.dto(r, lists.get(r.priceListId) ?? null, users));
  }

  /** One markdown with its prices: old price (the day before it starts) and new price per item. */
  async get(id: string, user: CurrentUser) {
    const company = await this.company.current();
    const md = await this.prisma.markdown.findUnique({ where: { id } });
    if (!md || md.companyId !== company.id) throw new NotFoundException('Markdown not found');
    const list = await this.prisma.priceList.findUniqueOrThrow({ where: { id: md.priceListId }, select: { id: true, code: true, name: true } });
    const prices = await this.prisma.price.findMany({ where: { markdownId: md.id }, include: { item: { select: { id: true, code: true, name: true, mrp: true, baseUnitId: true } } }, orderBy: { item: { code: 'asc' } } });
    const before = await this.priceOn(md.priceListId, prices.map((p) => p.item), addDays(date(md.startDate)!, -1), md.id);
    const users = await this.users([md.createdById, md.stoppedById]);
    void user;
    return {
      ...this.dto(md, list, users),
      lines: prices.map((p) => ({ itemId: p.item.id, code: p.item.code, name: p.item.name, mrp: p.item.mrp?.toFixed(2) ?? null, oldPrice: before.get(p.item.id) ?? null, newPrice: p.price.toFixed(2), priceId: p.id })),
    };
  }

  // ---- Working it out ----

  private async work(input: MarkdownInput, user: CurrentUser): Promise<{ list: { id: string; code: string; name: string }; lines: MarkdownLine[] }> {
    if (!hasPermission(user, 'prices.manage')) throw new ForbiddenException('You are not allowed to change prices');
    const company = await this.company.current();
    const settings = await this.settings.get();
    const listId = input.priceListId ?? settings.defaultSellingPriceListId;
    if (!listId) throw new BadRequestException('Choose a selling price list; no default selling list is set');
    const list = await this.prisma.priceList.findUnique({ where: { id: listId } });
    if (!list || list.companyId !== company.id) throw new NotFoundException('Price list not found');
    if (!list.forSelling) throw new BadRequestException(`${list.name} is not a selling price list`);
    if (!list.active) throw new BadRequestException(`${list.name} is switched off`);
    if (input.seasonId && !(await this.prisma.season.findFirst({ where: { id: input.seasonId, companyId: company.id } }))) throw new NotFoundException('Season not found');

    const items = await this.chooseItems(input);
    if (!items.length) throw new BadRequestException('No items match what was chosen');
    if (items.length > MAX_ITEMS) throw new BadRequestException(`That is ${items.length} items; mark down at most ${MAX_ITEMS} at a time`);
    const old = await this.priceOn(list.id, items, input.startDate);
    // A price already starting that day for the same item would make two prices on one date.
    const clashes = new Set(
      (
        await this.prisma.price.findMany({
          where: { priceListId: list.id, itemId: { in: items.map((i) => i.id) }, startDate: fromDate(input.startDate), customerId: null, supplierId: null, batchId: null, packSize: null },
          select: { itemId: true },
        })
      ).map((p) => p.itemId),
    );
    const lines = items.map((i): MarkdownLine => {
      const mrp = i.mrp?.toFixed(2) ?? null;
      const oldPrice = old.get(i.id) ?? null;
      const base = { itemId: i.id, code: i.code, name: i.name, mrp, oldPrice };
      if (!i.active) return { ...base, newPrice: null, cappedAtMrp: false, skipped: 'Switched off' };
      if (!i.canSell) return { ...base, newPrice: null, cappedAtMrp: false, skipped: 'Not for sale' };
      if (clashes.has(i.id)) return { ...base, newPrice: null, cappedAtMrp: false, skipped: `Already has a price from ${input.startDate}` };
      const r = markdownPrice(input.rule, input.value, oldPrice, mrp);
      if (!r) return { ...base, newPrice: null, cappedAtMrp: false, skipped: 'No price in this list to take the percentage off' };
      if (new Decimal(r.price).lte(0)) return { ...base, newPrice: null, cappedAtMrp: false, skipped: 'The new price would be zero' };
      return { ...base, newPrice: r.price, cappedAtMrp: r.cappedAtMrp, skipped: null };
    });
    return { list: { id: list.id, code: list.code, name: list.name }, lines };
  }

  /**
   * The items chosen: those matching every filter given (season, groups with
   * their sub-groups, brands), plus the items picked by hand. A style stands
   * for its variants, and a variant takes its style's season when it has none.
   */
  private async chooseItems(input: MarkdownInput) {
    const select = {
      id: true,
      code: true,
      name: true,
      mrp: true,
      active: true,
      canSell: true,
      baseUnitId: true,
      variantValues: { select: { attributeId: true, value: true } },
      parent: { select: { code: true, variantAttributes: { select: { attributeId: true }, orderBy: { sortOrder: 'asc' } } } },
    } as const;
    const out = new Map<string, Prisma.ItemGetPayload<{ select: typeof select }>>();
    if (input.seasonId || input.itemGroupIds?.length || input.brandIds?.length) {
      const groups = input.itemGroupIds?.length ? await this.prisma.itemGroup.findMany({ where: { id: { in: input.itemGroupIds } }, select: { path: true } }) : [];
      const where: Prisma.ItemWhereInput = {
        isParentStyle: false,
        AND: [
          ...(input.seasonId ? [{ OR: [{ seasonId: input.seasonId }, { seasonId: null, parent: { seasonId: input.seasonId } }] }] : []),
          ...(input.itemGroupIds?.length ? [{ OR: groups.map((g) => ({ itemGroup: { path: { startsWith: g.path } } })) }] : []),
          ...(input.brandIds?.length ? [{ brandId: { in: input.brandIds } }] : []),
        ],
      };
      for (const i of await this.prisma.item.findMany({ where, select, orderBy: { code: 'asc' }, take: MAX_ITEMS + 1 })) out.set(i.id, i);
    }
    if (input.itemIds?.length) {
      const picked = await this.prisma.item.findMany({ where: { OR: [{ id: { in: input.itemIds }, isParentStyle: false }, { parentItemId: { in: input.itemIds } }] }, select, orderBy: { code: 'asc' } });
      for (const i of picked) out.set(i.id, i);
    }
    // Launch check, 27 October 2026: a style's sizes in the order of their list (S, M, L), not by code.
    const rows = [...out.values()];
    const attributeIds = [...new Set(rows.flatMap((r) => r.variantValues.map((v) => v.attributeId)))];
    const values = attributeIds.length ? await this.prisma.variantAttributeValue.findMany({ where: { attributeId: { in: attributeIds } }, select: { attributeId: true, value: true, sortOrder: true } }) : [];
    const order = new Map(values.map((v) => [`${v.attributeId}|${v.value}`, v.sortOrder]));
    const families = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.parent?.code ?? r.code;
      families.set(key, [...(families.get(key) ?? []), r]);
    }
    return [...families.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, family]) => (family[0].parent ? sortVariants(family, family[0].parent.variantAttributes.map((a) => a.attributeId), order) : family));
  }

  /** Each item's general selling price (per basic unit) on a date, leaving out one markdown's own prices. */
  private async priceOn(priceListId: string, items: { id: string; baseUnitId: string }[], on: string, excludeMarkdownId?: string): Promise<Map<string, string>> {
    const rows = await this.prisma.price.findMany({
      where: { priceListId, itemId: { in: items.map((i) => i.id) }, customerId: null, supplierId: null, batchId: null, packSize: null, ...(excludeMarkdownId ? { OR: [{ markdownId: null }, { markdownId: { not: excludeMarkdownId } }] } : {}) },
    });
    const byItem = new Map<string, PriceCandidate[]>();
    for (const r of rows) {
      const c: PriceCandidate = { id: r.id, price: r.price.toString(), unitId: r.unitId, startDate: date(r.startDate)!, endDate: date(r.endDate), customerId: null, supplierId: null, batchId: null, packSize: null };
      byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), c]);
    }
    const out = new Map<string, string>();
    for (const i of items) {
      const chosen = selectPrice((byItem.get(i.id) ?? []).filter((c) => c.unitId === i.baseUnitId), { date: on, unitId: i.baseUnitId, quantity: '1' });
      if (chosen) out.set(i.id, new Decimal(chosen.price).toFixed(2));
    }
    return out;
  }

  private counts(lines: MarkdownLine[]) {
    return { items: lines.length, toChange: lines.filter((l) => !l.skipped).length, skipped: lines.filter((l) => l.skipped).length, cappedAtMrp: lines.filter((l) => !l.skipped && l.cappedAtMrp).length };
  }

  private async users(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    return new Map((await this.prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName}${u.lastName ? ` ${u.lastName}` : ''}`]));
  }

  private dto(
    m: { id: string; rule: string; value: Prisma.Decimal; startDate: Date; endDate: Date | null; chosenBy: Prisma.JsonValue; itemCount: number; remark: string | null; createdAt: Date; createdById: string | null; stoppedOn: Date | null; stoppedById: string | null; stoppedReason: string | null },
    list: { id: string; code: string; name: string } | null,
    users: Map<string, string>,
  ) {
    const today = businessDate();
    const start = date(m.startDate)!;
    const stoppedOn = date(m.stoppedOn);
    // Decision L3: a markdown stopped before its first day was withdrawn; one stopped later ended the day before.
    const withdrawn = stoppedOn !== null && start >= stoppedOn;
    const end = stoppedOn && !withdrawn ? addDays(stoppedOn, -1) : date(m.endDate);
    return {
      id: m.id,
      priceList: list,
      rule: m.rule as 'percent' | 'price',
      value: m.rule === 'percent' ? m.value.toDecimalPlaces(2).toString() : m.value.toFixed(2),
      startDate: start,
      endDate: end,
      status: withdrawn ? 'withdrawn' : start > today ? 'upcoming' : end && end < today ? 'ended' : 'running',
      stoppedOn,
      stoppedBy: m.stoppedById ? (users.get(m.stoppedById) ?? null) : null,
      stoppedReason: m.stoppedReason,
      chosenBy: m.chosenBy,
      itemCount: m.itemCount,
      remark: m.remark,
      createdAt: m.createdAt,
      createdBy: m.createdById ? (users.get(m.createdById) ?? null) : null,
    };
  }
}
