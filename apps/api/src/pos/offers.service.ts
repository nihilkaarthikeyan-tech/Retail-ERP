// Copyright (c) 2026, Rademics. All rights reserved.
// Offers and coupons (plan 06 answer 2: simple offers + coupons). The best
// offer is chosen automatically and a sale is never blocked (decision 17).
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { bestOffer, type CouponInput, Decimal, lineOfferSaving, type OfferInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Coupon, Offer } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PosCommon } from './pos-common.service.js';

export interface OfferContext {
  companyId: string;
  storeId: string;
  date: string;
  customerGroupId: string | null;
  /** The offer a coupon on the bill switches on, if any. */
  couponOfferId: string | null;
}

export interface ItemForOffers {
  id: string;
  parentItemId: string | null;
  brandId: string | null;
  itemGroup: { id: string; path: string };
}

export interface ChosenOffer {
  offer: Offer;
  saving: Decimal;
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
  ) {}

  // ---- Set-up ----

  async list() {
    const company = await this.common.currentCompany();
    const [offers, coupons] = await Promise.all([
      this.prisma.offer.findMany({ where: { companyId: company.id }, orderBy: [{ active: 'desc' }, { startDate: 'desc' }] }),
      this.prisma.coupon.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { offers: offers.map(offerDto), coupons: coupons.map(couponDto) };
  }

  async createOffer(input: OfferInput, actor: Actor) {
    const company = await this.common.currentCompany();
    if (await this.prisma.offer.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) throw new ConflictException(`Offer ${input.code} already exists`);
    await this.checkTargets(this.prisma, input);
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.offer.create({ data: { ...offerData(input), companyId: company.id, code: input.code, createdById: actor.userId, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'offer', entityId: o.id, changes: { code: o.code, kind: o.kind, appliesTo: o.appliesTo } });
      return offerDto(o);
    });
  }

  async updateOffer(id: string, input: OfferInput, actor: Actor) {
    const before = await this.prisma.offer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Offer not found');
    await this.checkTargets(this.prisma, input);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.offer.update({ where: { id }, data: { ...offerData(input), updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'offer', id, offerDto(before), offerDto(after));
      return offerDto(after);
    });
  }

  private async checkTargets(db: Db, input: OfferInput) {
    const ids = input.targetIds;
    if (!ids.length) return;
    const found =
      input.appliesTo === 'items'
        ? await db.item.count({ where: { id: { in: ids } } })
        : input.appliesTo === 'groups'
          ? await db.itemGroup.count({ where: { id: { in: ids } } })
          : input.appliesTo === 'brands'
            ? await db.brand.count({ where: { id: { in: ids } } })
            : 0;
    if (input.appliesTo !== 'bill' && found !== new Set(ids).size) throw new BadRequestException(`Some of the chosen ${input.appliesTo} were not found`);
    // Blueprint 04: a percentage offer cannot exceed a listed item's maximum discount.
    if (input.appliesTo === 'items' && input.kind === 'percent') {
      const over = await db.item.findFirst({ where: { id: { in: ids }, maxDiscountPercent: { lt: input.value ?? '0' } } });
      if (over) throw new BadRequestException(`${over.code} allows at most ${D(over.maxDiscountPercent).toFixed(2)}% discount`);
    }
  }

  async createCoupon(input: CouponInput, actor: Actor) {
    const company = await this.common.currentCompany();
    if (await this.prisma.coupon.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) throw new ConflictException(`Coupon ${input.code} already exists`);
    const offer = await this.prisma.offer.findUnique({ where: { id: input.offerId } });
    if (!offer || !offer.active || !offer.couponOnly) throw new BadRequestException('A coupon must switch on an active offer marked "only with a coupon"');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.coupon.create({
        data: {
          companyId: company.id,
          code: input.code,
          offerId: input.offerId,
          startDate: fromIso(input.startDate),
          endDate: input.endDate ? fromIso(input.endDate) : null,
          // A personal coupon is used once (blueprint 04).
          maxUses: input.customerId ? 1 : (input.maxUses ?? null),
          customerId: input.customerId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'coupon', entityId: c.id, changes: { code: c.code, offer: offer.code } });
      return couponDto(c);
    });
  }

  // ---- At billing time ----

  /** A coupon typed at the till: exists, in date, not used up, for this customer (blueprint 04 §5). */
  async couponFor(db: Db, companyId: string, code: string, date: string, customerId: string | null): Promise<Coupon> {
    const c = await db.coupon.findUnique({ where: { companyId_code: { companyId, code: code.trim().toUpperCase() } } });
    if (!c) throw new BadRequestException(`Coupon ${code} not found`);
    if (iso(c.startDate)! > date || (c.endDate && iso(c.endDate)! < date)) throw new BadRequestException(`Coupon ${c.code} is not valid today`);
    if (c.maxUses != null && c.usedCount >= c.maxUses) throw new BadRequestException(`Coupon ${c.code} has been used up`);
    if (c.customerId && c.customerId !== customerId) throw new BadRequestException(`Coupon ${c.code} belongs to another customer`);
    return c;
  }

  /** Coupon use is counted when the bill is saved and taken back when it is cancelled. */
  async countCouponUse(db: Db, couponId: string, delta: 1 | -1): Promise<void> {
    if (delta === 1) {
      const n = await db.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${couponId}::uuid AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
      if (n === 0) throw new BadRequestException('The coupon has been used up');
    } else {
      await db.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${couponId}::uuid`;
    }
  }

  async activeOffers(db: Db, ctx: OfferContext): Promise<Offer[]> {
    const d = fromIso(ctx.date);
    const offers = await db.offer.findMany({ where: { companyId: ctx.companyId, active: true, startDate: { lte: d }, OR: [{ endDate: null }, { endDate: { gte: d } }] } });
    return offers.filter(
      (o) =>
        (o.storeIds.length === 0 || o.storeIds.includes(ctx.storeId)) &&
        (!o.customerGroupId || o.customerGroupId === ctx.customerGroupId) &&
        (!o.couponOnly || o.id === ctx.couponOfferId),
    );
  }

  /** Does a line offer cover this item (the item or its style, its group or a parent group, its brand)? */
  covers(offer: Offer, item: ItemForOffers): boolean {
    switch (offer.appliesTo) {
      case 'items':
        return offer.targetIds.includes(item.id) || (!!item.parentItemId && offer.targetIds.includes(item.parentItemId));
      case 'groups':
        return offer.targetIds.some((g) => item.itemGroup.path.includes(`/${g}/`) || item.itemGroup.id === g);
      case 'brands':
        return !!item.brandId && offer.targetIds.includes(item.brandId);
      default:
        return false;
    }
  }

  /** The line offer giving the biggest saving (decision 17), or null. */
  bestLineOffer(offers: Offer[], item: ItemForOffers, line: { quantity: Decimal; price: Decimal }): ChosenOffer | null {
    const candidates = offers
      .filter((o) => o.appliesTo !== 'bill' && this.covers(o, item))
      .map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(toInput(o), line) }));
    const best = bestOffer(candidates);
    return best ? { offer: best.offer, saving: best.saving } : null;
  }

  /** The whole-bill offer giving the biggest saving on this amount, or null. */
  bestBillOffer(offers: Offer[], billAmount: Decimal): ChosenOffer | null {
    const candidates = offers
      .filter((o) => o.appliesTo === 'bill')
      .map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(toInput(o), { quantity: '1', price: billAmount }) }));
    const best = bestOffer(candidates);
    return best ? { offer: best.offer, saving: best.saving } : null;
  }
}

function toInput(o: Offer) {
  return {
    kind: o.kind as 'percent' | 'amount' | 'special_price' | 'free_goods',
    value: o.value?.toString() ?? null,
    buyQuantity: o.buyQuantity?.toString() ?? null,
    freeQuantity: o.freeQuantity?.toString() ?? null,
    minQuantity: o.minQuantity?.toString() ?? null,
    minAmount: o.minAmount?.toString() ?? null,
  };
}

function offerData(input: OfferInput) {
  return {
    name: input.name,
    kind: input.kind,
    appliesTo: input.appliesTo,
    targetIds: input.appliesTo === 'bill' ? [] : input.targetIds,
    value: input.value ?? null,
    buyQuantity: input.buyQuantity ?? null,
    freeQuantity: input.freeQuantity ?? null,
    minQuantity: input.minQuantity ?? null,
    minAmount: input.minAmount ?? null,
    storeIds: input.storeIds,
    customerGroupId: input.customerGroupId ?? null,
    startDate: fromIso(input.startDate),
    endDate: input.endDate ? fromIso(input.endDate) : null,
    priority: input.priority,
    couponOnly: input.couponOnly,
    active: input.active ?? true,
  };
}

export function offerDto(o: Offer) {
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    kind: o.kind,
    appliesTo: o.appliesTo,
    targetIds: o.targetIds,
    value: o.value?.toString() ?? null,
    buyQuantity: o.buyQuantity?.toString() ?? null,
    freeQuantity: o.freeQuantity?.toString() ?? null,
    minQuantity: o.minQuantity?.toString() ?? null,
    minAmount: o.minAmount?.toFixed(2) ?? null,
    storeIds: o.storeIds,
    customerGroupId: o.customerGroupId,
    startDate: iso(o.startDate),
    endDate: iso(o.endDate),
    priority: o.priority,
    couponOnly: o.couponOnly,
    active: o.active,
  };
}

function couponDto(c: Coupon) {
  return { id: c.id, code: c.code, offerId: c.offerId, startDate: iso(c.startDate), endDate: iso(c.endDate), maxUses: c.maxUses, usedCount: c.usedCount, customerId: c.customerId };
}
