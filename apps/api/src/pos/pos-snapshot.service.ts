// Copyright (c) 2026, Rademics. All rights reserved.
// What a till keeps on its own computer to bill offline (pos-offline §2):
// set-up, sellable items with barcodes, units and MRP, prices (with the next
// 7 days of price changes), GST rates, offers, coupons, customers with a
// mobile number, last known stock, the store's salespeople and delivery charge
// (plan 11 C1, B4), the till's last bill numbers and which optional modules
// are on (plan 12: the till hides switched-off buttons offline too). Never
// passwords, PINs or cost prices.
import { Injectable } from '@nestjs/common';
import { addDays, businessDate, type CurrentUser, GIFT_CARD_VALIDITY_MONTHS, tillNumberSeries } from 'shared';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { currentModuleMap } from '../modules/module-map.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fromIso, iso, PosCommon } from './pos-common.service.js';
import { offerDto } from './offers.service.js';

@Injectable()
export class PosSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: PosCommon,
    private readonly catalogue: CatalogueSettingsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async snapshot(tillId: string, since: string | undefined, user: CurrentUser, deviceToken: string | undefined) {
    const found = await this.common.usableTill(this.prisma, tillId, user);
    await this.common.assertDevice(this.prisma, found.id, deviceToken);
    // Plan 08: a till made before GST-length numbers gets its short invoice prefix now.
    const till = await this.common.ensureInvoicePrefix(this.prisma, found, user.id);
    const company = await this.common.currentCompany();
    const settings = await this.common.settings(this.prisma, company.id);
    const today = businessDate();
    const changedSince = since ? new Date(since) : null;
    const serverTime = new Date();

    const items = await this.prisma.item.findMany({
      where: { canSell: true, isParentStyle: false, ...(changedSince ? { updatedAt: { gt: changedSince } } : { active: true }) },
      include: { units: { include: { unit: { select: { code: true, allowsFractions: true } } } }, barcodes: { where: { active: true } }, itemGroup: { select: { id: true, path: true } } },
    });
    // The till's list, plus the default selling list when the price-list settings fall back to it (module 2 lookup rules).
    const mainList = await this.prisma.priceList.findUniqueOrThrow({ where: { id: till.priceListId } });
    const catalogue = await this.catalogue.get();
    const fallbackId = catalogue.fallbackToDefaultSellingList && catalogue.defaultSellingPriceListId && catalogue.defaultSellingPriceListId !== mainList.id && mainList.forSelling ? catalogue.defaultSellingPriceListId : null;
    const fallbackList = fallbackId ? await this.prisma.priceList.findFirst({ where: { id: fallbackId, active: true } }) : null;
    const listIds = [mainList.id, ...(fallbackList ? [fallbackList.id] : [])];
    const prices = await this.prisma.price.findMany({
      where: { priceListId: { in: listIds }, startDate: { lte: fromIso(addDays(today, 7)) }, OR: [{ endDate: null }, { endDate: { gte: fromIso(today) } }] },
    });
    const gstRates = await this.prisma.gstRate.findMany({ orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'asc' }] });
    // Plan 12: a switched-off module sends nothing to the till (offers, coupons, salespeople).
    const { map: modules } = await currentModuleMap(this.prisma);
    const offers = modules.offers ? await this.prisma.offer.findMany({ where: { companyId: company.id, active: true, OR: [{ endDate: null }, { endDate: { gte: fromIso(today) } }] } }) : [];
    const coupons = modules.offers ? await this.prisma.coupon.findMany({ where: { companyId: company.id, OR: [{ endDate: null }, { endDate: { gte: fromIso(today) } }] } }) : [];
    const partySettings = await this.prisma.partySettings.findUnique({ where: { companyId: company.id } });
    const customers = await this.prisma.customer.findMany({
      where: { companyId: company.id, OR: [{ mobile: { not: null } }, { id: partySettings?.walkInCustomerId ?? '00000000-0000-0000-0000-000000000000' }], ...(changedSince ? { updatedAt: { gt: changedSince } } : {}) },
      select: { id: true, code: true, name: true, mobile: true, gstin: true, taxSituation: true, stateCode: true, customerGroupId: true, status: true },
    });
    const stock = await this.prisma.stockPosition.findMany({ where: { locationId: till.locationId }, select: { itemId: true, quantity: true } });
    // Plan 11 part 2: goods set aside for ready customer orders, so the till warns before selling them offline too.
    const reserved = await this.prisma.stockReservation.groupBy({ by: ['itemId'], where: { locationId: till.locationId, releasedAt: null }, _sum: { quantity: true } });
    const years = await this.prisma.financialYear.findMany({ where: { companyId: company.id, status: 'open' }, select: { name: true, startDate: true, endDate: true } });
    const lastNumbers = await Promise.all(
      years.map(async (y) => {
        const prefix = tillNumberSeries(till.seriesKind, y.name);
        const last = await this.prisma.posBill.findFirst({ where: { tillId: till.id, number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
        return { financialYear: y.name, prefix, lastNumber: last?.number ?? null };
      }),
    );
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: till.storeId } });
    const salesStaff = modules.salesperson ? await this.prisma.salesStaff.findMany({ where: { storeId: till.storeId, active: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }) : [];
    // Plan 08: the seller's registration and the GST settings the till bills with offline too.
    const seller = await this.common.gst.sellerFor(this.prisma, till.storeId);
    const gstSettings = await this.common.gst.settingsFor(this.prisma, company.id);
    // Plan 13: the scheme's limits, so the till can show what may be spent (the balance itself needs the connection).
    const loyalty = modules.loyalty ? await this.loyalty.settingsRow(this.prisma, company.id) : null;

    return {
      serverTime,
      full: !changedSince,
      modules,
      till: {
        id: till.id,
        code: till.code,
        name: till.name,
        numberPrefix: till.seriesKind,
        locationId: till.locationId,
        priceListId: till.priceListId,
        pricesPerUnit: mainList.pricesPerUnit,
        fallbackPriceList: fallbackList ? { id: fallbackList.id, pricesPerUnit: fallbackList.pricesPerUnit } : null,
        cashierDiscountPercent: till.cashierDiscountPercent.toString(),
        allowPriceChange: till.allowPriceChange,
        autoPrint: till.autoPrint,
        receiptFooter: till.receiptFooter,
        store: { id: store.id, code: store.code, name: store.name, address: [store.addressLine1, store.addressLine2, store.city, store.pincode].filter(Boolean).join(', '), phone: store.phone, stateCode: store.stateCode ?? company.stateCode },
        company: { legalName: company.legalName, stateCode: company.stateCode, gstin: seller.gstin },
        gst: { scheme: gstSettings.scheme, approved: !!gstSettings.approvedAt, hsnDigits: gstSettings.hsnDigits, receiptTaxTable: gstSettings.receiptTaxTable, sellerState: seller.stateCode },
        paymentMethods: till.paymentMethods.map((m) => ({ id: m.paymentMethodId, code: m.paymentMethod.code, name: m.paymentMethod.name, kind: m.paymentMethod.kind, allowRefund: m.paymentMethod.allowRefund, needsReference: m.paymentMethod.needsReference, isDefault: m.isDefault, active: m.paymentMethod.active })),
        liveAllowed: settings.liveAllowed,
        walkInCustomerId: partySettings?.walkInCustomerId ?? null,
        // Plan 11 B4 (decision 47): the store's home-delivery charge and the item it is billed as.
        delivery: { charge: store.deliveryCharge.toFixed(2), freeAbove: store.deliveryFreeAbove?.toFixed(2) ?? null, itemId: settings.deliveryItemId },
        // Plan 11 part 2: the service item an alteration charge is billed as.
        alterationItemId: settings.alterationItemId,
        // Plan 13: points (spent online only) and gift cards (sold and spent online only).
        loyalty: loyalty ? { schemeName: loyalty.schemeName, pointValue: loyalty.pointValue.toString(), minRedeem: loyalty.minRedeem, maxSharePercent: loyalty.maxSharePercent.toString(), earnSpend: loyalty.earnSpend.toFixed(2), earnPoints: loyalty.earnPoints } : null,
        giftCards: modules.gift_cards ? { validityMonths: GIFT_CARD_VALIDITY_MONTHS } : null,
      },
      salesStaff,
      financialYears: years.map((y) => ({ name: y.name, startDate: iso(y.startDate), endDate: iso(y.endDate) })),
      lastNumbers,
      items: items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        active: i.active && (!i.endDate || iso(i.endDate)! >= today),
        isStockItem: i.isStockItem,
        trackBatches: i.trackBatches,
        trackSerials: i.trackSerials,
        hsnCode: i.hsnCode,
        mrp: i.mrp?.toFixed(2) ?? null,
        maxDiscountPercent: i.maxDiscountPercent.toString(),
        baseUnitId: i.baseUnitId,
        parentItemId: i.parentItemId,
        brandId: i.brandId,
        itemGroup: i.itemGroup,
        units: i.units.map((u) => ({ unitId: u.unitId, code: u.unit.code, factor: u.factor.toString(), allowsFractions: u.unit.allowsFractions, mrp: u.mrp?.toFixed(2) ?? null })),
        barcodes: i.barcodes.map((b) => ({ code: b.code, unitId: b.unitId })),
      })),
      prices: prices.map((p) => ({ id: p.id, priceListId: p.priceListId, itemId: p.itemId, unitId: p.unitId, price: p.price.toString(), startDate: iso(p.startDate), endDate: iso(p.endDate), customerId: p.customerId, batchId: p.batchId, packSize: p.packSize?.toString() ?? null })),
      gstRates: gstRates.map((r) => ({ hsnCode: r.hsnCode, rate: r.rate.toString(), kind: r.kind, priceFrom: r.priceFrom?.toString() ?? null, priceUpTo: r.priceUpTo?.toString() ?? null, effectiveFrom: iso(r.effectiveFrom), approved: !!r.approvedAt })),
      offers: offers.map(offerDto),
      coupons: coupons.map((c) => ({ code: c.code, offerId: c.offerId, startDate: iso(c.startDate), endDate: iso(c.endDate), maxUses: c.maxUses, usedCount: c.usedCount, customerId: c.customerId })),
      customers,
      stock: stock.map((s) => ({ itemId: s.itemId, quantity: s.quantity.toString() })),
      reserved: reserved.map((r) => ({ itemId: r.itemId, quantity: (r._sum.quantity ?? 0).toString() })),
    };
  }
}
