// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreatePriceInput,
  type CreatePriceListInput,
  type CurrentUser,
  Decimal,
  hasPermission,
  type PriceCandidate,
  type PriceLookupInput,
  type PriceQuery,
  rateForLine,
  selectPrice,
  type StylePriceInput,
  type UpdatePriceInput,
  type UpdatePriceListInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Price, PriceList } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const date = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
const fromDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export interface PriceLookupResult {
  found: boolean;
  priceId: string | null;
  priceListId: string | null;
  /** The stored price and the unit it is for. */
  price: string | null;
  priceUnitId: string | null;
  /** The rate for the line's own unit, rounded to paise. */
  rate: string | null;
  source: 'list' | 'default_list' | null;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly settings: CatalogueSettingsService,
  ) {}

  // ---- Price lists ----

  /** Buying lists are hidden from users without buying_prices.view (decision 70). */
  async listPriceLists(user: CurrentUser) {
    const company = await this.company.current();
    const lists = await this.prisma.priceList.findMany({ where: { companyId: company.id }, orderBy: { name: 'asc' } });
    return lists.filter((l) => this.mayViewList(user, l));
  }

  private mayViewList(user: CurrentUser, list: PriceList): boolean {
    if (list.forBuying && !hasPermission(user, 'buying_prices.view')) return false;
    return hasPermission(user, 'prices.view');
  }

  private async getList(db: Db, id: string, user: CurrentUser): Promise<PriceList> {
    const list = await db.priceList.findUnique({ where: { id } });
    if (!list) throw new NotFoundException('Price list not found');
    if (!this.mayViewList(user, list)) throw new ForbiddenException('You may not see buying prices');
    return list;
  }

  async createPriceList(input: CreatePriceListInput, actor: Actor) {
    const company = await this.company.current();
    if (await this.prisma.priceList.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) {
      throw new ConflictException(`Price list ${input.code} already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.priceList.create({
        data: { companyId: company.id, ...input, pricesPerUnit: input.pricesPerUnit ?? false, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'price_list',
        entityId: created.id,
        changes: { code: created.code, forSelling: created.forSelling, forBuying: created.forBuying },
      });
      return created;
    });
  }

  async updatePriceList(id: string, input: UpdatePriceListInput, actor: Actor) {
    const before = await this.prisma.priceList.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Price list not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.priceList.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'price_list', id, before, after);
      return after;
    });
  }

  // ---- Prices ----

  async listPrices(q: PriceQuery, user: CurrentUser) {
    if (q.priceListId) await this.getList(this.prisma, q.priceListId, user);
    const visibleListIds = q.priceListId ? undefined : (await this.listPriceLists(user)).map((l) => l.id);
    const today = q.date ?? businessDate();
    const rows = await this.prisma.price.findMany({
      where: {
        ...(q.priceListId ? { priceListId: q.priceListId } : { priceListId: { in: visibleListIds } }),
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.includeEnded === 'true' ? {} : { OR: [{ endDate: null }, { endDate: { gte: fromDate(today) } }] }),
      },
      include: { item: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, code: true } }, priceList: { select: { id: true, code: true, name: true } } },
      orderBy: [{ item: { code: 'asc' } }, { startDate: 'desc' }],
      take: 500,
    });
    return rows.map(toPriceDto);
  }

  /** The same price on every variant of a style that has none in the list on that date (see stylePriceSchema). */
  async createStylePrices(input: StylePriceInput, actor: Actor, user: CurrentUser) {
    const list = await this.getList(this.prisma, input.priceListId, user);
    if (!list.active) throw new BadRequestException('Price list is switched off');
    const style = await this.prisma.item.findUnique({ where: { id: input.styleId } });
    if (!style || !style.isParentStyle) throw new BadRequestException('Choose a style with sizes and colours');
    const startDate = input.startDate ?? businessDate();
    const on = fromDate(startDate);
    const variants = await this.prisma.item.findMany({ where: { parentItemId: style.id, active: true }, orderBy: { code: 'asc' } });
    if (!variants.length) throw new BadRequestException(`${style.code} has no sizes or colours yet; create them first`);
    return this.prisma.$transaction(async (tx) => {
      const added: string[] = [];
      const kept: string[] = [];
      for (const v of variants) {
        const existing = await tx.price.findFirst({
          where: { priceListId: list.id, itemId: v.id, unitId: v.baseUnitId, customerId: null, supplierId: null, batchId: null, packSize: null, startDate: { lte: on }, OR: [{ endDate: null }, { endDate: { gte: on } }] },
        });
        if (existing) {
          kept.push(v.code);
          continue;
        }
        const price = await tx.price.create({
          data: { priceListId: list.id, itemId: v.id, unitId: v.baseUnitId, price: new Decimal(input.price), startDate: on, createdById: actor.userId, updatedById: actor.userId },
        });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'price', entityId: price.id, changes: { item: v.code, list: list.code, price: input.price, startDate, style: style.code } });
        added.push(v.code);
      }
      return { added, kept };
    });
  }

  async createPrice(input: CreatePriceInput, actor: Actor, user: CurrentUser) {
    const list = await this.getList(this.prisma, input.priceListId, user);
    if (!list.active) throw new BadRequestException('Price list is switched off');
    if (input.customerId && !list.forSelling) throw new BadRequestException('A customer price needs a selling list');
    if (input.supplierId && !list.forBuying) throw new BadRequestException('A supplier price needs a buying list');
    if (input.customerId && !(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: list.companyId } }))) {
      throw new BadRequestException('Customer not found');
    }
    if (input.supplierId && !(await this.prisma.supplier.findFirst({ where: { id: input.supplierId, companyId: list.companyId } }))) {
      throw new BadRequestException('Supplier not found');
    }
    const item = await this.prisma.item.findUnique({ where: { id: input.itemId }, include: { units: true } });
    if (!item) throw new NotFoundException('Item not found');
    if (item.isParentStyle) throw new BadRequestException('Prices are set on variants, not on the style');
    const unitId = input.unitId ?? item.baseUnitId;
    if (!item.units.some((u) => u.unitId === unitId)) throw new BadRequestException('The price unit must be one of the item’s units');
    const startDate = input.startDate ?? businessDate();
    const duplicate = await this.prisma.price.findFirst({
      where: {
        priceListId: list.id,
        itemId: item.id,
        unitId,
        startDate: fromDate(startDate),
        endDate: input.endDate ? fromDate(input.endDate) : null,
        packSize: input.packSize ? new Decimal(input.packSize) : null,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        batchId: null,
      },
    });
    if (duplicate) throw new ConflictException('An identical price already exists');

    const created = await this.prisma.$transaction(async (tx) => {
      const price = await tx.price.create({
        data: {
          priceListId: list.id,
          itemId: item.id,
          unitId,
          price: new Decimal(input.price),
          startDate: fromDate(startDate),
          endDate: input.endDate ? fromDate(input.endDate) : null,
          packSize: input.packSize ? new Decimal(input.packSize) : null,
          customerId: input.customerId ?? null,
          supplierId: input.supplierId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: { item: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, code: true } }, priceList: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'price',
        entityId: price.id,
        changes: { item: item.code, list: list.code, unit: price.unit.code, price: input.price, startDate, endDate: input.endDate ?? null, customerId: input.customerId ?? null, supplierId: input.supplierId ?? null },
      });
      return price;
    });
    return toPriceDto(created);
  }

  /** Price changes are logged with old and new value (reliability rule 9). */
  async updatePrice(id: string, input: UpdatePriceInput, actor: Actor, user: CurrentUser) {
    const before = await this.prisma.price.findUnique({ where: { id }, include: { item: { select: { code: true } }, priceList: true } });
    if (!before) throw new NotFoundException('Price not found');
    if (!this.mayViewList(user, before.priceList)) throw new ForbiddenException('You may not see buying prices');
    if (input.endDate && input.endDate < date(before.startDate)!) throw new BadRequestException('End date cannot be before start date');
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.price.update({
        where: { id },
        data: {
          price: input.price === undefined ? undefined : new Decimal(input.price),
          endDate: input.endDate === undefined ? undefined : input.endDate === null ? null : fromDate(input.endDate),
          updatedById: actor.userId,
        },
        include: { item: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, code: true } }, priceList: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.recordUpdate(
        tx,
        actor,
        'price',
        id,
        { item: before.item.code, price: before.price.toString(), endDate: date(before.endDate) },
        { item: after.item.code, price: after.price.toString(), endDate: date(after.endDate) },
      );
      return after;
    });
    return toPriceDto(updated);
  }

  // ---- Lookup (blueprint 04, process 1) ----

  async lookup(input: PriceLookupInput, user: CurrentUser): Promise<PriceLookupResult> {
    const settings = await this.settings.get();
    const listId = input.priceListId ?? settings.defaultSellingPriceListId;
    if (!listId) throw new BadRequestException('No price list given and no default selling list set');
    const list = await this.getList(this.prisma, listId, user);
    const item = await this.prisma.item.findUnique({ where: { id: input.itemId }, include: { units: true } });
    if (!item) throw new NotFoundException('Item not found');
    const unitId = input.unitId ?? item.baseUnitId;
    const lineUnit = item.units.find((u) => u.unitId === unitId);
    if (!lineUnit) throw new BadRequestException('The unit must be one of the item’s units');
    const ctx = {
      date: input.date ?? businessDate(),
      unitId,
      quantity: input.quantity ?? '1',
      customerId: input.customerId ?? null,
      supplierId: input.supplierId ?? null,
      batchId: input.batchId ?? null,
    };

    const inList = await this.find(list.id, item.id, ctx);
    if (inList) return this.result(inList, list, lineUnit, item.units, 'list');

    // No price in the bill's list: the default selling list, if allowed and different.
    if (settings.fallbackToDefaultSellingList && settings.defaultSellingPriceListId && settings.defaultSellingPriceListId !== list.id && list.forSelling) {
      const fallbackList = await this.prisma.priceList.findUnique({ where: { id: settings.defaultSellingPriceListId } });
      if (fallbackList?.active) {
        const inDefault = await this.find(fallbackList.id, item.id, ctx);
        if (inDefault) return this.result(inDefault, fallbackList, lineUnit, item.units, 'default_list');
      }
    }
    return { found: false, priceId: null, priceListId: null, price: null, priceUnitId: null, rate: null, source: null };
  }

  private async find(priceListId: string, itemId: string, ctx: Parameters<typeof selectPrice>[1]): Promise<Price | null> {
    const rows = await this.prisma.price.findMany({ where: { priceListId, itemId } });
    const candidates: PriceCandidate[] = rows.map((r) => ({
      id: r.id,
      price: r.price.toString(),
      unitId: r.unitId,
      startDate: date(r.startDate)!,
      endDate: date(r.endDate),
      customerId: r.customerId,
      supplierId: r.supplierId,
      batchId: r.batchId,
      packSize: r.packSize?.toString() ?? null,
    }));
    const chosen = selectPrice(candidates, ctx);
    return chosen ? (rows.find((r) => r.id === chosen.id) ?? null) : null;
  }

  private result(price: Price, list: PriceList, lineUnit: { unitId: string; factor: Decimal }, units: { unitId: string; factor: Decimal }[], source: 'list' | 'default_list'): PriceLookupResult {
    const priceUnit = units.find((u) => u.unitId === price.unitId) ?? { unitId: price.unitId, factor: new Decimal(1) };
    const rate = rateForLine(
      { price: price.price.toString(), unitId: price.unitId },
      { unitId: lineUnit.unitId, unitFactor: lineUnit.factor.toString() },
      priceUnit.factor.toString(),
      list.pricesPerUnit,
    );
    return { found: true, priceId: price.id, priceListId: list.id, price: price.price.toString(), priceUnitId: price.unitId, rate: rate.toFixed(2), source };
  }
}

function toPriceDto(p: Price & { item: { id: string; code: string; name: string }; unit: { id: string; code: string }; priceList: { id: string; code: string; name: string } }) {
  return {
    id: p.id,
    priceList: p.priceList,
    item: p.item,
    unit: p.unit,
    price: p.price.toString(),
    startDate: date(p.startDate),
    endDate: date(p.endDate),
    packSize: p.packSize?.toString() ?? null,
    customerId: p.customerId,
    supplierId: p.supplierId,
    batchId: p.batchId,
    updatedAt: p.updatedAt,
  };
}
