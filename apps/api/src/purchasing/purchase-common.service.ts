// Copyright (c) 2026, Rademics. All rights reserved.
// Helpers shared by every purchasing document (plan 05 §4): supplier and item
// checks, units, buying prices, GST as stated, dates, locations and defaults.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CurrentUser,
  Decimal,
  documentTotals,
  gstProblem,
  hasPermission,
  lineAmounts,
  type PermissionKey,
  quantityProblem,
  roundQuantity,
  suggestGst,
} from 'shared';
import type { Db } from '../audit/audit.service.js';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { Item, PurchaseSettings, StockLocation, Store, Supplier } from '../generated/prisma/client.js';
import { GstCoreService } from '../gst/gst-core.service.js';
import { ItemsService } from '../items/items.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { SuppliersService } from '../parties/suppliers.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const D = (v: { toString(): string } | string | number) => new Decimal(v.toString());
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);

/** Number series per purchasing document (company-wide patterns; module 1 engine). */
export const PURCHASE_NUMBER_SERIES: Record<string, string> = {
  purchase_order: 'PO-{STORE}-{FY}-',
  goods_receipt: 'GRN-{STORE}-{FY}-',
  purchase_return: 'PRT-{STORE}-{FY}-',
  supplier_bill: 'PB-{FY}-',
  debit_note: 'DN-{FY}-',
  landed_charge: 'LC-{FY}-',
  consignment_statement: 'CS-{STORE}-{FY}-',
};

/**
 * Idempotent: purchase settings and number series for a company.
 * Safe when several requests ask at the same moment: rows that already exist are skipped, never an error.
 */
export async function ensurePurchaseDefaults(db: Db, companyId: string): Promise<PurchaseSettings> {
  await db.numberSeries.createMany({
    data: Object.entries(PURCHASE_NUMBER_SERIES).map(([documentKind, pattern]) => ({ companyId, documentKind, pattern, counterLength: 5 })),
    skipDuplicates: true,
  });
  await db.purchaseSettings.createMany({ data: [{ companyId }], skipDuplicates: true });
  return db.purchaseSettings.findUniqueOrThrow({ where: { companyId } });
}

export interface PricedLineInput {
  quantity: string;
  rate: string;
  discountPercent?: string | null;
  discountAmount?: string | null;
  gstRate: string;
  cgst?: string;
  sgst?: string;
  igst?: string;
}

export interface PricedLine {
  rate: Decimal;
  discountPercent: Decimal;
  discountAmount: Decimal;
  taxable: Decimal;
  gstRate: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  lineTotal: Decimal;
}

export interface ItemUnitInfo {
  item: Item;
  unitId: string;
  unitCode: string;
  factor: Decimal;
  allowsFractions: boolean;
}

@Injectable()
export class PurchaseCommon {
  constructor(
    readonly prisma: PrismaService,
    private readonly company: CompanyService,
    private readonly items: ItemsService,
    private readonly suppliers: SuppliersService,
    private readonly pricing: PricingService,
    private readonly catalogue: CatalogueSettingsService,
    private readonly years: FinancialYearsService,
    private readonly numbering: NumberingService,
    private readonly gst: GstCoreService,
  ) {}

  /** Companies set up before module 5 get their settings and number series. */

  /** Next document number; purchase series are created on first use for companies set up later. */
  async allocate(tx: Db, req: { companyId: string; documentKind: string; storeId?: string | null; date?: string }): Promise<string> {
    await ensurePurchaseDefaults(tx, req.companyId);
    return this.numbering.allocate(tx, req);
  }

  currentCompany(db: Db = this.prisma) {
    return this.company.current(db);
  }

  settings(db: Db, companyId: string): Promise<PurchaseSettings> {
    return ensurePurchaseDefaults(db, companyId);
  }

  requireRight(user: CurrentUser, key: PermissionKey): void {
    if (!hasPermission(user, key)) throw new ForbiddenException(`You do not have the right "${key}"`);
  }

  /** Orders and bills: module 3's check (switched off, blocked, held). */
  supplierForBills(db: Db, supplierId: string, user: CurrentUser): Promise<Supplier> {
    return this.suppliers.assertSupplierUsable(db, supplierId, 'bills', user);
  }

  /** Receipts and returns: goods may still arrive or go back while bills are held; never for a switched-off supplier. */
  async supplierForGoods(db: Db, supplierId: string, user: CurrentUser): Promise<Supplier> {
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new BadRequestException('Supplier not found');
    if (supplier.status === 'off') throw new BadRequestException(`Supplier ${supplier.code} is switched off`);
    if (supplier.status === 'blocked' && !hasPermission(user, 'suppliers.hold')) {
      throw new ForbiddenException(`Supplier ${supplier.code} is blocked; only the trusted role may post for them`);
    }
    return supplier;
  }

  async store(db: Db, companyId: string, storeId: string): Promise<Store> {
    const store = await db.store.findFirst({ where: { id: storeId, companyId } });
    if (!store) throw new BadRequestException('Store not found');
    if (!store.active) throw new BadRequestException(`Store ${store.code} is switched off`);
    return store;
  }

  /** IGST between states, CGST + SGST within the same state (the receiving store's GSTIN state). */
  async interState(db: Db, supplier: Supplier, storeId: string | null): Promise<boolean> {
    return (await this.placeOfSupply(db, supplier, storeId)).interState;
  }

  /**
   * Plan 08 G1 for purchases: the supplier's state (from the supplier, else
   * its main billing address) against the state of the GST registration the
   * receiving store belongs to (else the store's or the company's state).
   * The place of supply of goods is where the goods are delivered, i.e. the
   * receiving store (IGST Act section 10(1)(a),
   * https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section10_v1.00.html);
   * the supply is inter-state when the supplier's state differs from it
   * (section 7, same source).
   */
  async placeOfSupply(db: Db, supplier: Supplier, storeId: string | null): Promise<{ interState: boolean; placeOfSupply: string; supplierState: string | null; gstRegistrationId: string | null }> {
    const company = await this.currentCompany(db);
    const store = storeId ? await db.store.findUnique({ where: { id: storeId }, include: { gstRegistration: true } }) : null;
    const registration =
      store?.gstRegistration ?? (await db.gstRegistration.findFirst({ where: { companyId: company.id, active: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
    const placeOfSupply = store?.gstRegistration?.stateCode ?? store?.stateCode ?? registration?.stateCode ?? company.stateCode;
    let supplierState = supplier.stateCode ?? (supplier.gstin ? supplier.gstin.slice(0, 2) : null);
    if (!supplierState) {
      const address = await db.address.findFirst({ where: { partyType: 'supplier', partyId: supplier.id, active: true, isBilling: true }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
      supplierState = address?.stateCode ?? null;
    }
    return { interState: !!supplierState && supplierState !== placeOfSupply, placeOfSupply, supplierState, gstRegistrationId: registration?.id ?? null };
  }

  /** Plan 08 G7: a composition company claims no input credit; purchase tax goes into the cost of the goods. */
  async isComposition(db: Db, companyId: string): Promise<boolean> {
    const s = await db.gstSettings.findUnique({ where: { companyId }, select: { scheme: true } });
    return s?.scheme === 'composition';
  }

  /** Item usable for buying, its unit factor, and quantity checks (decision 11). */
  async itemUnit(db: Db, itemId: string, unitId: string | undefined, quantities: (string | null | undefined)[], purpose: 'purchase' | 'stock' = 'purchase'): Promise<ItemUnitInfo> {
    const item = await this.items.assertItemUsable(db, itemId, 'purchase');
    if (purpose === 'stock' && !item.isStockItem) throw new BadRequestException(`${item.code} is not a stock item`);
    const uid = unitId ?? item.baseUnitId;
    const itemUnit = await db.itemUnit.findUnique({ where: { itemId_unitId: { itemId: item.id, unitId: uid } }, include: { unit: true } });
    if (!itemUnit) throw new BadRequestException(`${item.code}: the unit must be one of the item’s units`);
    for (const q of quantities) {
      if (q == null || D(q).eq(0)) continue;
      const problem = quantityProblem(q, itemUnit.unit);
      if (problem) throw new BadRequestException(`${item.code}: ${problem}`);
    }
    return { item, unitId: uid, unitCode: itemUnit.unit.code, factor: D(itemUnit.factor), allowsFractions: itemUnit.unit.allowsFractions };
  }

  /**
   * Buying price for a line (blueprint 07): the supplier's buying price list
   * (or the default buying list), else the last purchase price × unit size.
   * Null when nothing is known; the caller then asks for a price.
   */
  async buyingRate(db: Db, supplier: Supplier, info: ItemUnitInfo, date: string, quantity: string, user: CurrentUser): Promise<string | null> {
    const settings = await this.catalogue.get(db);
    const listId = supplier.priceListId ?? settings.defaultBuyingPriceListId;
    if (listId) {
      try {
        const found = await this.pricing.lookup({ itemId: info.item.id, unitId: info.unitId, priceListId: listId, date, quantity, supplierId: supplier.id }, user);
        if (found.found && found.rate !== null) return found.rate;
      } catch {
        // A list the user may not read or a missing price falls through to the last purchase price.
      }
    }
    const company = await this.currentCompany(db);
    const purchase = await this.settings(db, company.id);
    if (purchase.fillLastPurchasePrice && info.item.lastPurchasePrice && D(info.item.lastPurchasePrice).gt(0)) {
      return D(info.item.lastPurchasePrice).mul(info.factor).toDecimalPlaces(4).toString();
    }
    return null;
  }

  /**
   * Plan 05 §2: the GST rate is pre-filled from the last purchase of the item. Decision L4 (owner,
   * 28 October 2026): an item never bought takes the GST rate list's rate for its HSN code (the band
   * of the price per piece before GST, when given), and 0 only when the list has none.
   */
  async lastGstRate(db: Db, itemId: string, at?: { date: string; rate?: string | null; factor?: Decimal }): Promise<string> {
    const receipt = await db.goodsReceiptLine.findFirst({ where: { itemId, receipt: { status: { notIn: ['draft', 'cancelled'] }, isReturn: false } }, orderBy: { receipt: { postingAt: 'desc' } }, select: { gstRate: true } });
    if (receipt) return receipt.gstRate.toString();
    const order = await db.purchaseOrderLine.findFirst({ where: { itemId, order: { status: { not: 'cancelled' } } }, orderBy: { order: { createdAt: 'desc' } }, select: { gstRate: true } });
    if (order) return order.gstRate.toString();
    const item = await db.item.findUnique({ where: { id: itemId }, select: { code: true, hsnCode: true } });
    if (!item?.hsnCode) return '0';
    const perPiece = at?.rate != null && at.factor && !at.factor.isZero() ? D(at.rate).div(at.factor) : null;
    const listed = await this.gst.rateFor(db, item, at?.date ?? businessDate(), perPiece).catch(() => null);
    return listed && listed.kind !== 'exempt' && listed.kind !== 'nil' ? listed.rate.toString() : '0';
  }

  /**
   * Amounts for a line from the charged quantity and the GST as written on the
   * supplier's document (plan 05 answer 2): omitted GST figures are suggested
   * from the rate; typed ones must add up.
   */
  price(line: PricedLineInput, interState: boolean, label: string): PricedLine {
    let amounts;
    try {
      amounts = lineAmounts({ quantity: line.quantity, rate: line.rate, discountPercent: line.discountPercent ?? null, discountAmount: line.discountAmount ?? null });
    } catch (err) {
      throw new BadRequestException(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const typed = line.cgst !== undefined || line.sgst !== undefined || line.igst !== undefined;
    const gst = typed
      ? { cgst: D(line.cgst ?? '0'), sgst: D(line.sgst ?? '0'), igst: D(line.igst ?? '0') }
      : suggestGst(amounts.taxable, line.gstRate, interState);
    const problem = gstProblem({ taxable: amounts.taxable, gstRate: line.gstRate, ...gst });
    if (problem) throw new BadRequestException(`${label}: ${problem}`);
    return {
      rate: D(line.rate),
      discountPercent: D(line.discountPercent ?? '0'),
      discountAmount: D(line.discountAmount ?? '0'),
      taxable: amounts.taxable,
      gstRate: D(line.gstRate),
      cgst: D(gst.cgst),
      sgst: D(gst.sgst),
      igst: D(gst.igst),
      lineTotal: amounts.taxable.add(gst.cgst).add(gst.sgst).add(gst.igst),
    };
  }

  totals(lines: { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }[]) {
    const t = documentTotals(lines);
    return { taxableAmount: t.taxable.toFixed(2), taxAmount: t.tax.toFixed(2), roundingAdjustment: t.roundingAdjustment.toFixed(2), total: t.total.toFixed(2) };
  }

  /** Posting dates (rule 15): not in the future, inside an open financial year. */
  async checkPostingDate(db: Db, companyId: string, date: string, what: string): Promise<{ id: string; name: string }> {
    if (date > businessDate()) throw new BadRequestException(`${what} cannot be dated in the future`);
    const year = await this.years.forDate(db, companyId, date);
    if (!year) throw new BadRequestException(`No financial year covers ${date}`);
    if (year.status !== 'open') throw new BadRequestException(`Financial year ${year.name} is locked`);
    return year;
  }

  /** Stock-moving documents: the month-end stock lock too (decision 36). */
  async checkStockDate(db: Db, companyId: string, date: string, what: string): Promise<void> {
    await this.checkPostingDate(db, companyId, date, what);
    const settings = await db.inventorySettings.findUnique({ where: { companyId } });
    if (settings?.stockLockDate && date <= iso(settings.stockLockDate)!) {
      throw new BadRequestException(`Stock is locked up to ${iso(settings.stockLockDate)}; nothing can be posted on or before that date`);
    }
  }

  /** Decision 35: dated before a later movement of these items → Accountant only, current month only. */
  async checkBackdating(tx: Db, itemIds: string[], locationIds: string[], postingAt: Date, postingDate: string, user: CurrentUser): Promise<boolean> {
    const later = await tx.stockLedgerEntry.findFirst({ where: { itemId: { in: itemIds }, locationId: { in: locationIds }, postingAt: { gt: postingAt } }, select: { id: true } });
    if (!later) return false;
    if (!hasPermission(user, 'stock.backdate')) throw new ForbiddenException('Later movements of these items exist; only the Accountant may post an earlier date');
    if (postingDate.slice(0, 7) !== businessDate().slice(0, 7)) throw new ForbiddenException('Back-dated stock entries are allowed only within the current month');
    return true;
  }

  /** The store's shelf location (Shop floor by default) or the one chosen. */
  async shelfLocation(db: Db, companyId: string, storeId: string, locationId: string | null | undefined): Promise<StockLocation> {
    if (locationId) {
      const loc = await db.stockLocation.findUnique({ where: { id: locationId } });
      if (!loc || loc.companyId !== companyId || loc.storeId !== storeId) throw new BadRequestException('The location must belong to the receiving store');
      if (!loc.active) throw new BadRequestException(`Location ${loc.name} is switched off`);
      if (loc.kind !== 'shelf') throw new BadRequestException(`${loc.name} is not a shelf location; rejected goods go to the Rejected location automatically`);
      return loc;
    }
    const loc = await db.stockLocation.findFirst({ where: { storeId, kind: 'shelf', active: true }, orderBy: { code: 'desc' } }); // "-FLOOR" sorts after "-BACK"
    if (!loc) throw new BadRequestException('The receiving store has no shelf location');
    return loc;
  }

  /** Decision 30: rejected goods are held in the store's Rejected location. */
  async rejectedLocation(db: Db, storeId: string): Promise<StockLocation> {
    const loc = await db.stockLocation.findFirst({ where: { storeId, kind: 'rejected', active: true } });
    if (!loc) throw new BadRequestException('The receiving store has no Rejected location');
    return loc;
  }

  /** Quantity in basic units, rounded to 3 places. */
  basic(quantity: Decimal | string, factor: Decimal): Decimal {
    return roundQuantity(D(quantity).mul(factor));
  }

  /** Stores the user may see, or undefined for all. */
  storeFilter(user: CurrentUser): string[] | undefined {
    return user.allStores ? undefined : user.stores.map((s) => s.id);
  }
}
