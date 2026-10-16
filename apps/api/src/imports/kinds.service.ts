// Copyright (c) 2026, Rademics. All rights reserved.
// The kinds of records that can be imported and exported (plan 10 §1.C–D).
// Lookups are by the codes people see (item group code, unit code, store
// code); writes go through the module services so their rules apply.
import { BadRequestException, Injectable } from '@nestjs/common';
import { businessDate, Decimal, type ImportKind, type ImportMode } from 'shared';
import { ClosingService } from '../accounting/closing.service.js';
import { MastersService } from '../catalogue/masters.service.js';
import { InventoryMastersService } from '../inventory/inventory-masters.service.js';
import { StockDocumentsService } from '../inventory/stock-documents.service.js';
import { ItemsService } from '../items/items.service.js';
import { CustomersService } from '../parties/customers.service.js';
import { SuppliersService } from '../parties/suppliers.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { bool, type Importer, type ImportContext, type ParsedRow, type RowOutcome, str } from './importers.js';

type V = ParsedRow['values'];
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
type Num = string | number | boolean | { toString(): string } | null | undefined;
/** Two numbers equal (a decimal from the database against a value read from the file); empty equals empty. */
const sameNumber = (a: Num, b: Num) => (a === undefined || a === null || a === '' ? b === null || b === undefined : b !== null && b !== undefined && new Decimal(a.toString()).eq(new Decimal(b.toString())));
const BARCODE_LENGTHS = [8, 12, 13, 14];

@Injectable()
export class ImportKindsService {
  private readonly importers: Map<ImportKind, Importer>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly masters: MastersService,
    private readonly items: ItemsService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly inventory: InventoryMastersService,
    private readonly stockDocs: StockDocumentsService,
    private readonly closing: ClosingService,
  ) {
    this.importers = new Map(
      [this.itemGroups(), this.brands(), this.itemsKind(), this.prices(), this.customersKind(), this.suppliersKind(), this.reorderLevels(), this.openingStock(), this.openingBills()].map((i) => [i.kind, i]),
    );
  }

  get(kind: ImportKind): Importer {
    const i = this.importers.get(kind);
    if (!i) throw new BadRequestException('Unknown kind of import');
    return i;
  }

  // ---- Lookups by the codes people see ----

  private async id<T extends { id: string }>(label: string, code: string | undefined, find: (code: string) => Promise<T | null>): Promise<string | undefined> {
    if (!code) return undefined;
    const row = await find(code);
    if (!row) throw new BadRequestException(`${label} "${code}" was not found`);
    return row.id;
  }

  private group = (code?: string) => this.id('Item group', code, (c) => this.prisma.itemGroup.findUnique({ where: { code: c } }));
  private brand = (code?: string) => this.id('Brand', code, (c) => this.prisma.brand.findUnique({ where: { code: c } }));
  private unit = (code?: string) => this.id('Unit', code, (c) => this.prisma.unit.findFirst({ where: { code: { equals: c, mode: 'insensitive' } } }));
  private item = (code?: string) => this.id('Item', code, (c) => this.prisma.item.findUnique({ where: { code: c } }));
  private store = (companyId: string, code?: string) => this.id('Store', code, (c) => this.prisma.store.findFirst({ where: { companyId, code: c } }));
  private terms = (code?: string) => this.id('Payment terms', code, (c) => this.prisma.paymentTerms.findUnique({ where: { code: c } }));
  private priceList = (companyId: string, code?: string) => this.id('Price list', code, (c) => this.prisma.priceList.findFirst({ where: { companyId, code: c } }));

  // ---- Item groups and brands ----

  private itemGroups(): Importer {
    return {
      kind: 'item_groups',
      importRight: 'import.masters',
      rights: ['catalogue.manage'],
      fields: [
        { key: 'code', label: 'Group code', type: 'code', required: true },
        { key: 'name', label: 'Group name', type: 'text', required: true },
        { key: 'parent', label: 'Parent group code', type: 'code', hint: 'Leave empty for a top-level group; a parent may come earlier in the same file' },
        { key: 'hsn', label: 'HSN code', type: 'code', digitsLength: [4, 6, 8] },
      ],
      example: ['RICE', 'Rice', 'GROC', '1006'],
      keyOf: (v) => str(v.code) ?? null,
      apply: async (v, mode, ctx) => {
        const existing = await this.prisma.itemGroup.findUnique({ where: { code: str(v.code)! } });
        if (existing) {
          if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
          const change: { name?: string; hsnCode?: string | null } = {};
          if (str(v.name) && str(v.name) !== existing.name) change.name = str(v.name);
          if (str(v.hsn) !== undefined && str(v.hsn) !== existing.hsnCode) change.hsnCode = str(v.hsn);
          if (!Object.keys(change).length) return { outcome: 'unchanged', recordId: existing.id };
          await this.masters.updateGroup(existing.id, change, ctx.actor);
          return { outcome: 'changed', recordId: existing.id };
        }
        if (mode === 'change') throw new BadRequestException(`Item group ${str(v.code)} does not exist`);
        const created = await this.masters.createGroup({ code: str(v.code)!, name: str(v.name)!, parentId: (await this.group(str(v.parent))) ?? null, hsnCode: str(v.hsn) ?? null }, ctx.actor);
        return { outcome: 'added', recordId: (created as { id: string }).id };
      },
    };
  }

  private brands(): Importer {
    return {
      kind: 'brands',
      importRight: 'import.masters',
      rights: ['catalogue.manage'],
      fields: [
        { key: 'code', label: 'Brand code', type: 'code', required: true },
        { key: 'name', label: 'Brand name', type: 'text', required: true },
      ],
      example: ['AASHIRVAAD', 'Aashirvaad'],
      keyOf: (v) => str(v.code) ?? null,
      apply: async (v, mode, ctx) => {
        const existing = await this.prisma.brand.findUnique({ where: { code: str(v.code)! } });
        if (existing) {
          if (mode === 'add' || existing.name === str(v.name)) return { outcome: 'unchanged', recordId: existing.id, message: mode === 'add' ? 'Already there' : undefined };
          await this.masters.updateBrand(existing.id, { name: str(v.name)! }, ctx.actor);
          return { outcome: 'changed', recordId: existing.id };
        }
        if (mode === 'change') throw new BadRequestException(`Brand ${str(v.code)} does not exist`);
        const created = await this.masters.createBrand({ code: str(v.code)!, name: str(v.name)! }, ctx.actor);
        return { outcome: 'added', recordId: (created as { id: string }).id };
      },
    };
  }

  // ---- Items ----

  private itemsKind(): Importer {
    return {
      kind: 'items',
      importRight: 'import.masters',
      rights: ['catalogue.manage'],
      fields: [
        { key: 'code', label: 'Item code', type: 'code', hint: 'Leave empty to number new items automatically; needed to change an item' },
        { key: 'name', label: 'Item name', type: 'text', required: true },
        { key: 'group', label: 'Item group code', type: 'code', required: true },
        { key: 'brand', label: 'Brand code', type: 'code' },
        { key: 'unit', label: 'Unit', type: 'code', required: true, hint: 'The basic unit, e.g. PCS, KG, LTR' },
        { key: 'hsn', label: 'HSN code', type: 'code', digitsLength: [4, 6, 8] },
        { key: 'mrp', label: 'MRP', type: 'number' },
        { key: 'maxDiscount', label: 'Maximum discount %', type: 'number', aliases: ['Max discount'] },
        { key: 'stocked', label: 'Kept in stock', type: 'yesno', hint: 'Yes or No (default Yes)' },
        { key: 'canSell', label: 'Can be sold', type: 'yesno' },
        { key: 'canBuy', label: 'Can be bought', type: 'yesno' },
        { key: 'batches', label: 'Track batches', type: 'yesno' },
        { key: 'shelfLife', label: 'Shelf life days', type: 'number' },
        { key: 'price', label: 'Selling price', type: 'number', hint: 'Including GST, per basic unit, in the default selling price list' },
        { key: 'barcode', label: 'Barcode', type: 'code', digitsLength: BARCODE_LENGTHS },
        { key: 'barcode2', label: 'Second barcode', type: 'code', digitsLength: BARCODE_LENGTHS },
        { key: 'packUnit', label: 'Pack unit', type: 'code', hint: 'A bigger unit it is also sold or bought in, e.g. BOX' },
        { key: 'packSize', label: 'Pack size', type: 'number', hint: 'How many basic units in one pack' },
        { key: 'packBarcode', label: 'Pack barcode', type: 'code', digitsLength: BARCODE_LENGTHS },
      ],
      example: ['', 'Ponni Rice 1 kg', 'RICE', 'AASHIRVAAD', 'PCS', '1006', 72, 5, 'Yes', 'Yes', 'Yes', 'No', '', 70, '8901234567890', '', 'BOX', 10, ''],
      keyOf: (v) => str(v.code) ?? (str(v.name) ? `${str(v.group)}|${str(v.name)!.toLowerCase()}` : null),
      apply: (v, mode, ctx) => this.applyItem(v, mode, ctx),
      exportRows: async () => {
        const settings = await this.prisma.catalogueSettings.findFirst();
        const today = businessDate();
        const rows = await this.prisma.item.findMany({
          where: { isParentStyle: false },
          include: { itemGroup: true, brand: true, baseUnit: true, units: { include: { unit: true } }, barcodes: { where: { active: true }, orderBy: { createdAt: 'asc' } } },
          orderBy: { code: 'asc' },
        });
        const prices = settings?.defaultSellingPriceListId
          ? await this.prisma.price.findMany({ where: { priceListId: settings.defaultSellingPriceListId, customerId: null, supplierId: null, batchId: null, startDate: { lte: new Date(`${today}T00:00:00Z`) }, OR: [{ endDate: null }, { endDate: { gte: new Date(`${today}T00:00:00Z`) } }] }, orderBy: { startDate: 'desc' } })
          : [];
        return rows.map((i) => {
          const pack = i.units.find((u) => u.unitId !== i.baseUnitId);
          const basicBarcodes = i.barcodes.filter((b) => !b.unitId || b.unitId === i.baseUnitId);
          const price = prices.find((p) => p.itemId === i.id && p.unitId === i.baseUnitId);
          return [
            i.code,
            i.name,
            i.itemGroup.code,
            i.brand?.code ?? null,
            i.baseUnit.code,
            i.hsnCode,
            i.mrp ? Number(i.mrp.toFixed(2)) : null,
            Number(i.maxDiscountPercent.toString()),
            i.isStockItem ? 'Yes' : 'No',
            i.canSell ? 'Yes' : 'No',
            i.canBuy ? 'Yes' : 'No',
            i.trackBatches ? 'Yes' : 'No',
            i.shelfLifeDays,
            price ? Number(price.price.toString()) : null,
            basicBarcodes[0]?.code ?? null,
            basicBarcodes[1]?.code ?? null,
            pack?.unit.code ?? null,
            pack ? Number(pack.factor.toString()) : null,
            pack ? (i.barcodes.find((b) => b.unitId === pack.unitId)?.code ?? null) : null,
          ];
        });
      },
    };
  }

  private async applyItem(v: V, mode: ImportMode, ctx: ImportContext): Promise<RowOutcome> {
    const code = str(v.code);
    let existing = code ? await this.prisma.item.findUnique({ where: { code } }) : null;
    // Without a code, an item of the same name in the same group counts as already there (a rerun adds nothing twice).
    if (!existing && !code) {
      const groupId = await this.group(str(v.group));
      existing = await this.prisma.item.findFirst({ where: { itemGroupId: groupId, name: { equals: str(v.name)!, mode: 'insensitive' } } });
    }
    const groupId = await this.group(str(v.group));
    const brandId = await this.brand(str(v.brand));
    const baseUnitId = await this.unit(str(v.unit));
    if (existing) {
      if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
      const full = await this.prisma.item.findUniqueOrThrow({ where: { id: existing.id }, include: { units: true, barcodes: true } });
      if (baseUnitId && baseUnitId !== full.baseUnitId) throw new BadRequestException('The basic unit of an item cannot be changed by import');
      const change: Record<string, unknown> = {};
      if (str(v.name) && str(v.name) !== full.name) change.name = str(v.name);
      if (groupId && groupId !== full.itemGroupId) change.itemGroupId = groupId;
      if (str(v.brand) !== undefined && brandId !== full.brandId) change.brandId = brandId;
      if (str(v.hsn) !== undefined && str(v.hsn) !== full.hsnCode) change.hsnCode = str(v.hsn);
      if (str(v.mrp) !== undefined && !sameNumber(v.mrp, full.mrp)) change.mrp = str(v.mrp);
      if (str(v.maxDiscount) !== undefined && !sameNumber(v.maxDiscount, full.maxDiscountPercent)) change.maxDiscountPercent = str(v.maxDiscount);
      for (const [k, f] of [['stocked', 'isStockItem'], ['canSell', 'canSell'], ['canBuy', 'canBuy'], ['batches', 'trackBatches']] as const) {
        const b = bool(v[k]);
        if (b !== undefined && b !== full[f]) change[f] = b;
      }
      if (str(v.shelfLife) !== undefined && Number(v.shelfLife) !== full.shelfLifeDays) change.shelfLifeDays = Number(v.shelfLife);
      let changed = false;
      if (Object.keys(change).length) {
        await this.items.update(full.id, change, ctx.actor, ctx.user);
        changed = true;
      }
      changed = (await this.itemExtras(full.id, full.baseUnitId, v, ctx)) || changed;
      changed = (await this.itemPrice(full.id, full.baseUnitId, v, ctx)) || changed;
      return { outcome: changed ? 'changed' : 'unchanged', recordId: full.id };
    }
    if (mode === 'change') throw new BadRequestException(`Item ${code ?? str(v.name)} does not exist`);
    const packUnitId = await this.unit(str(v.packUnit));
    if (packUnitId && !str(v.packSize)) throw new BadRequestException('Pack size is missing for the pack unit');
    const created = (await this.items.create(
      {
        code,
        name: str(v.name)!,
        itemGroupId: groupId!,
        brandId: brandId ?? null,
        baseUnitId: baseUnitId!,
        hsnCode: str(v.hsn) ?? null,
        mrp: str(v.mrp) ?? null,
        maxDiscountPercent: str(v.maxDiscount),
        isStockItem: bool(v.stocked) ?? true,
        canSell: bool(v.canSell),
        canBuy: bool(v.canBuy),
        trackBatches: bool(v.batches),
        shelfLifeDays: str(v.shelfLife) ? Number(v.shelfLife) : null,
        units: packUnitId ? [{ unitId: packUnitId, factor: str(v.packSize)! }] : undefined,
        sellingPrice: str(v.price) ?? null,
      },
      ctx.actor,
      ctx.user,
    )) as { id: string; baseUnitId?: string };
    await this.itemExtras(created.id, baseUnitId!, v, ctx, true);
    return { outcome: 'added', recordId: created.id };
  }

  /** Barcodes and the pack unit: added when missing; an existing pack unit with another size is refused. */
  private async itemExtras(itemId: string, baseUnitId: string, v: V, ctx: ImportContext, justCreated = false): Promise<boolean> {
    let changed = false;
    const packUnitId = await this.unit(str(v.packUnit));
    if (packUnitId && !justCreated) {
      const units = await this.prisma.itemUnit.findMany({ where: { itemId } });
      const have = units.find((u) => u.unitId === packUnitId);
      if (have && str(v.packSize) && !sameNumber(v.packSize, have.factor)) throw new BadRequestException('The pack size of an item already in use cannot be changed by import');
      if (!have) {
        if (!str(v.packSize)) throw new BadRequestException('Pack size is missing for the pack unit');
        await this.items.setUnits(itemId, { units: [...units.filter((u) => u.unitId !== baseUnitId).map((u) => ({ unitId: u.unitId, factor: u.factor.toString(), mrp: u.mrp?.toString() ?? null })), { unitId: packUnitId, factor: str(v.packSize)! }] }, ctx.actor, ctx.user);
        changed = true;
      }
    }
    for (const [key, unitId] of [['barcode', null], ['barcode2', null], ['packBarcode', packUnitId ?? null]] as const) {
      const code = str(v[key]);
      if (!code) continue;
      const found = await this.prisma.barcode.findUnique({ where: { code } });
      if (found) {
        if (found.itemId !== itemId) throw new BadRequestException(`Barcode ${code} already belongs to another item`);
        continue;
      }
      if (key === 'packBarcode' && !unitId) throw new BadRequestException('A pack barcode needs the pack unit');
      await this.items.addBarcode(itemId, { code, unitId }, ctx.actor);
      changed = true;
    }
    return changed;
  }

  /** In change mode a different selling price is added as a new price from today, keeping the old one (blueprint 17). */
  private async itemPrice(itemId: string, baseUnitId: string, v: V, ctx: ImportContext): Promise<boolean> {
    if (!str(v.price)) return false;
    const settings = await this.prisma.catalogueSettings.findFirst();
    if (!settings?.defaultSellingPriceListId) throw new BadRequestException('No default selling price list is set');
    const today = businessDate();
    const current = await this.prisma.price.findFirst({
      where: { priceListId: settings.defaultSellingPriceListId, itemId, unitId: baseUnitId, customerId: null, supplierId: null, batchId: null, startDate: { lte: new Date(`${today}T00:00:00Z`) }, OR: [{ endDate: null }, { endDate: { gte: new Date(`${today}T00:00:00Z`) } }] },
      orderBy: { startDate: 'desc' },
    });
    if (current && sameNumber(v.price, current.price)) return false;
    await this.pricing.createPrice({ priceListId: settings.defaultSellingPriceListId, itemId, unitId: baseUnitId, price: str(v.price)!, startDate: today }, ctx.actor, ctx.user);
    return true;
  }

  // ---- Prices ----

  private prices(): Importer {
    return {
      kind: 'prices',
      importRight: 'import.masters',
      rights: ['prices.manage'],
      fields: [
        { key: 'list', label: 'Price list code', type: 'code', required: true },
        { key: 'item', label: 'Item code', type: 'code', required: true },
        { key: 'unit', label: 'Unit', type: 'code', hint: 'Empty = the basic unit' },
        { key: 'price', label: 'Price', type: 'number', required: true },
        { key: 'start', label: 'Start date', type: 'date', hint: 'Empty = today' },
        { key: 'end', label: 'End date', type: 'date' },
        { key: 'customer', label: 'Customer code', type: 'code', hint: 'Only for a price given to one customer' },
      ],
      example: ['STD-SELL', 'ITM-000001', 'PCS', 75, '2026-11-01', '', ''],
      keyOf: (v) => [str(v.list), str(v.item), str(v.unit) ?? '', str(v.start) ?? '', str(v.customer) ?? ''].join('|'),
      apply: async (v, mode, ctx) => {
        const priceListId = (await this.priceList(ctx.companyId, str(v.list)))!;
        const itemId = (await this.item(str(v.item)))!;
        const item = await this.prisma.item.findUniqueOrThrow({ where: { id: itemId } });
        const unitId = (await this.unit(str(v.unit))) ?? item.baseUnitId;
        const customerId = (await this.id('Customer', str(v.customer), (c) => this.prisma.customer.findUnique({ where: { code: c } }))) ?? null;
        const startDate = str(v.start) ?? businessDate();
        const existing = await this.prisma.price.findFirst({ where: { priceListId, itemId, unitId, customerId, supplierId: null, batchId: null, startDate: new Date(`${startDate}T00:00:00Z`) } });
        if (existing) {
          if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'A price with this start date is already there' };
          const change: { price?: string; endDate?: string | null } = {};
          if (!sameNumber(v.price, existing.price)) change.price = str(v.price);
          if (str(v.end) !== undefined && str(v.end) !== iso(existing.endDate)) change.endDate = str(v.end);
          if (!Object.keys(change).length) return { outcome: 'unchanged', recordId: existing.id };
          await this.pricing.updatePrice(existing.id, change, ctx.actor, ctx.user);
          return { outcome: 'changed', recordId: existing.id };
        }
        if (mode === 'change') throw new BadRequestException('There is no price with this start date to change');
        const created = (await this.pricing.createPrice({ priceListId, itemId, unitId, price: str(v.price)!, startDate, endDate: str(v.end) ?? null, customerId }, ctx.actor, ctx.user)) as { id: string };
        return { outcome: 'added', recordId: created.id };
      },
      exportRows: async ({ companyId }) => {
        const rows = await this.prisma.price.findMany({
          where: { priceList: { companyId }, supplierId: null, batchId: null },
          include: { priceList: true, item: true, unit: true },
          orderBy: [{ priceList: { code: 'asc' } }, { item: { code: 'asc' } }, { startDate: 'asc' }],
        });
        const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map((c) => [c.id, c.code]));
        return rows.map((p) => [p.priceList.code, p.item.code, p.unit.code, Number(p.price.toString()), iso(p.startDate), iso(p.endDate), p.customerId ? (customers.get(p.customerId) ?? null) : null]);
      },
    };
  }

  // ---- Customers and suppliers ----

  private partyFields(kind: 'customer' | 'supplier') {
    return [
      { key: 'code', label: kind === 'customer' ? 'Customer code' : 'Supplier code', type: 'code' as const, hint: 'Leave empty to number automatically' },
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
      { key: 'mobile', label: 'Mobile', type: 'code' as const, digitsLength: [10] },
      { key: 'email', label: 'Email', type: 'text' as const },
      { key: 'group', label: kind === 'customer' ? 'Customer group code' : 'Supplier group code', type: 'code' as const },
      { key: 'gstin', label: 'GSTIN', type: 'code' as const },
      ...(kind === 'supplier' ? [{ key: 'pan', label: 'PAN', type: 'code' as const }] : []),
      { key: 'state', label: 'State code', type: 'code' as const, digitsLength: [2], hint: 'GST state code, e.g. 33 for Tamil Nadu' },
      { key: 'terms', label: 'Payment terms code', type: 'code' as const },
      { key: 'line1', label: 'Address line 1', type: 'text' as const },
      { key: 'line2', label: 'Address line 2', type: 'text' as const },
      { key: 'city', label: 'City', type: 'text' as const },
      { key: 'pincode', label: 'PIN code', type: 'code' as const, digitsLength: [6] },
    ];
  }

  /** The address on the row; its state is the row's state code, else the company's. */
  private async address(v: V, companyId: string) {
    if (!str(v.line1) && !str(v.city)) return null;
    if (!str(v.line1) || !str(v.city)) throw new BadRequestException('An address needs both the first line and the city');
    const stateCode = str(v.state) ?? (await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } })).stateCode;
    return { addressLine1: str(v.line1)!, addressLine2: str(v.line2) ?? null, city: str(v.city)!, stateCode, pincode: str(v.pincode) ?? null, gstin: str(v.gstin) ?? null, isBilling: true, isMain: true };
  }

  private customersKind(): Importer {
    return {
      kind: 'customers',
      importRight: 'import.masters',
      rights: ['customers.manage'],
      fields: this.partyFields('customer'),
      example: ['', 'Lakshmi Stores', '9840011223', '', 'RETAIL', '', '33', 'NET30', '12 Market Road', '', 'Chennai', '600001'],
      keyOf: (v) => str(v.code) ?? str(v.mobile) ?? null,
      apply: async (v, mode, ctx) => {
        const existing = str(v.code)
          ? await this.prisma.customer.findUnique({ where: { code: str(v.code)! } })
          : str(v.mobile)
            ? await this.prisma.customer.findFirst({ where: { companyId: ctx.companyId, mobile: str(v.mobile)! } })
            : null;
        const groupId = await this.id('Customer group', str(v.group), (c) => this.prisma.customerGroup.findUnique({ where: { code: c } }));
        const termsId = await this.terms(str(v.terms));
        if (existing) {
          if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
          const change: Record<string, unknown> = {};
          for (const [k, f] of [['name', 'name'], ['mobile', 'mobile'], ['email', 'email'], ['gstin', 'gstin'], ['state', 'stateCode']] as const) {
            if (str(v[k]) !== undefined && str(v[k]) !== (existing as Record<string, unknown>)[f]) change[f] = str(v[k]);
          }
          if (groupId && groupId !== existing.customerGroupId) change.customerGroupId = groupId;
          if (termsId && termsId !== existing.paymentTermsId) change.paymentTermsId = termsId;
          if (!Object.keys(change).length) return { outcome: 'unchanged', recordId: existing.id };
          await this.customers.update(existing.id, { ...change, confirmDuplicate: true }, ctx.actor);
          return { outcome: 'changed', recordId: existing.id };
        }
        if (mode === 'change') throw new BadRequestException('This customer does not exist');
        const created = (await this.customers.create(
          { code: str(v.code), name: str(v.name)!, mobile: str(v.mobile) ?? null, email: str(v.email) ?? null, customerGroupId: groupId, gstin: str(v.gstin) ?? null, stateCode: str(v.state) ?? null, paymentTermsId: termsId ?? null, isBusiness: !!str(v.gstin), address: await this.address(v, ctx.companyId) },
          ctx.actor,
        )) as { id: string };
        return { outcome: 'added', recordId: created.id };
      },
      exportRows: async ({ companyId }) => {
        const rows = await this.prisma.customer.findMany({ where: { companyId, isWalkIn: false }, include: { customerGroup: true, paymentTerms: true }, orderBy: { code: 'asc' } });
        const addresses = await this.prisma.address.findMany({ where: { partyType: 'customer', partyId: { in: rows.map((r) => r.id) }, isMain: true } });
        return rows.map((c) => {
          const a = addresses.find((x) => x.partyId === c.id);
          return [c.code, c.name, c.mobile, c.email, c.customerGroup.code, c.gstin, c.stateCode, c.paymentTerms?.code ?? null, a?.addressLine1 ?? null, a?.addressLine2 ?? null, a?.city ?? null, a?.pincode ?? null];
        });
      },
    };
  }

  private suppliersKind(): Importer {
    return {
      kind: 'suppliers',
      importRight: 'import.masters',
      rights: ['suppliers.manage'],
      fields: this.partyFields('supplier'),
      example: ['', 'Sri Murugan Traders', '9840012345', '', 'DISTRIBUTORS', '33AAACM1234B1ZQ', 'AAACM1234B', '33', 'NET30', '4 Godown Street', '', 'Chennai', '600001'],
      keyOf: (v) => str(v.code) ?? str(v.gstin) ?? (str(v.name) ? str(v.name)!.toLowerCase() : null),
      apply: async (v, mode, ctx) => {
        const existing = str(v.code)
          ? await this.prisma.supplier.findUnique({ where: { code: str(v.code)! } })
          : str(v.gstin)
            ? await this.prisma.supplier.findFirst({ where: { companyId: ctx.companyId, gstin: str(v.gstin)! } })
            : await this.prisma.supplier.findFirst({ where: { companyId: ctx.companyId, name: { equals: str(v.name)!, mode: 'insensitive' } } });
        const groupId = await this.id('Supplier group', str(v.group), (c) => this.prisma.supplierGroup.findUnique({ where: { code: c } }));
        const termsId = await this.terms(str(v.terms));
        if (existing) {
          if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
          const change: Record<string, unknown> = {};
          for (const [k, f] of [['name', 'name'], ['mobile', 'mobile'], ['email', 'email'], ['gstin', 'gstin'], ['pan', 'pan'], ['state', 'stateCode']] as const) {
            if (str(v[k]) !== undefined && str(v[k]) !== (existing as Record<string, unknown>)[f]) change[f] = str(v[k]);
          }
          if (groupId && groupId !== existing.supplierGroupId) change.supplierGroupId = groupId;
          if (termsId && termsId !== existing.paymentTermsId) change.paymentTermsId = termsId;
          if (!Object.keys(change).length) return { outcome: 'unchanged', recordId: existing.id };
          await this.suppliers.update(existing.id, change, ctx.actor);
          return { outcome: 'changed', recordId: existing.id };
        }
        if (mode === 'change') throw new BadRequestException('This supplier does not exist');
        const created = (await this.suppliers.create(
          { code: str(v.code), name: str(v.name)!, mobile: str(v.mobile) ?? null, email: str(v.email) ?? null, supplierGroupId: groupId, gstin: str(v.gstin) ?? null, pan: str(v.pan) ?? null, stateCode: str(v.state) ?? null, paymentTermsId: termsId ?? null, isBusiness: !!str(v.gstin), address: await this.address(v, ctx.companyId) },
          ctx.actor,
        )) as { id: string };
        return { outcome: 'added', recordId: created.id };
      },
      exportRows: async ({ companyId }) => {
        const rows = await this.prisma.supplier.findMany({ where: { companyId }, include: { supplierGroup: true, paymentTerms: true }, orderBy: { code: 'asc' } });
        const addresses = await this.prisma.address.findMany({ where: { partyType: 'supplier', partyId: { in: rows.map((r) => r.id) }, isMain: true } });
        return rows.map((s) => {
          const a = addresses.find((x) => x.partyId === s.id);
          return [s.code, s.name, s.mobile, s.email, s.supplierGroup.code, s.gstin, s.pan, s.stateCode, s.paymentTerms?.code ?? null, a?.addressLine1 ?? null, a?.addressLine2 ?? null, a?.city ?? null, a?.pincode ?? null];
        });
      },
    };
  }

  // ---- Reorder levels ----

  private reorderLevels(): Importer {
    return {
      kind: 'reorder_levels',
      importRight: 'import.masters',
      rights: ['stock.locations.manage'],
      fields: [
        { key: 'item', label: 'Item code', type: 'code', required: true },
        { key: 'store', label: 'Store code', type: 'code', required: true },
        { key: 'level', label: 'Reorder at', type: 'number', required: true, hint: 'Order more when stock falls to this' },
        { key: 'quantity', label: 'Order quantity', type: 'number', required: true },
      ],
      example: ['ITM-000001', 'MAIN', 20, 100],
      keyOf: (v) => `${str(v.item)}|${str(v.store)}`,
      apply: async (v, mode, ctx) => {
        const itemId = (await this.item(str(v.item)))!;
        const storeId = (await this.store(ctx.companyId, str(v.store)))!;
        const existing = await this.prisma.reorderLevel.findUnique({ where: { itemId_storeId: { itemId, storeId } } });
        if (existing) {
          if (mode === 'add') return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
          if (sameNumber(v.level, existing.level) && sameNumber(v.quantity, existing.quantity)) return { outcome: 'unchanged', recordId: existing.id };
        } else if (mode === 'change') throw new BadRequestException('There is no reorder level for this item and store');
        await this.inventory.setReorder({ itemId, storeId, level: str(v.level)!, quantity: str(v.quantity)! }, ctx.actor, ctx.user);
        return { outcome: existing ? 'changed' : 'added', recordId: existing?.id ?? null };
      },
      exportRows: async ({ companyId }) => {
        const stores = await this.prisma.store.findMany({ where: { companyId }, select: { id: true, code: true } });
        const rows = await this.prisma.reorderLevel.findMany({ where: { storeId: { in: stores.map((s) => s.id) } } });
        const items = new Map((await this.prisma.item.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, code: true } })).map((i) => [i.id, i.code]));
        return rows.map((r) => [items.get(r.itemId) ?? null, stores.find((s) => s.id === r.storeId)?.code ?? null, Number(r.level.toString()), Number(r.quantity.toString())]);
      },
    };
  }

  // ---- Opening stock and opening bills ----

  private openingStock(): Importer {
    return {
      kind: 'opening_stock',
      importRight: 'import.opening',
      rights: ['stock.count'],
      fields: [
        { key: 'store', label: 'Store code', type: 'code', required: true },
        { key: 'location', label: 'Location code', type: 'code', required: true, hint: 'e.g. MAIN-FLOOR' },
        { key: 'item', label: 'Item code', type: 'code', required: true },
        { key: 'quantity', label: 'Quantity', type: 'number', required: true, hint: 'In the basic unit' },
        { key: 'cost', label: 'Cost per unit', type: 'number', required: true, hint: 'Before GST, per basic unit' },
        { key: 'batch', label: 'Batch', type: 'code' },
        { key: 'expiry', label: 'Expiry date', type: 'date' },
      ],
      example: ['MAIN', 'MAIN-FLOOR', 'ITM-000001', 120, 52, '', ''],
      keyOf: (v) => `${str(v.location)}|${str(v.item)}|${str(v.batch) ?? ''}`,
      // Rows are gathered into one draft opening count per location by the import service.
      apply: async () => ({ outcome: 'unchanged' }),
    };
  }

  /** Opening stock: one draft opening count per location from all valid rows (checked by hand, then finalised). */
  async openingCounts(rows: { rowNumber: number; values: V }[], ctx: ImportContext): Promise<Map<number, RowOutcome | { error: string }>> {
    const out = new Map<number, RowOutcome | { error: string }>();
    const byLocation = new Map<string, { storeId: string; locationId: string; rows: { rowNumber: number; values: V; itemId: string }[] }>();
    for (const r of rows) {
      try {
        const storeId = (await this.store(ctx.companyId, str(r.values.store)))!;
        const loc = await this.prisma.stockLocation.findFirst({ where: { companyId: ctx.companyId, code: str(r.values.location)! } });
        if (!loc || loc.storeId !== storeId) throw new BadRequestException(`Location ${str(r.values.location)} is not a location of store ${str(r.values.store)}`);
        const itemId = (await this.item(str(r.values.item)))!;
        const g = byLocation.get(loc.id) ?? { storeId, locationId: loc.id, rows: [] };
        g.rows.push({ ...r, itemId });
        byLocation.set(loc.id, g);
      } catch (err) {
        out.set(r.rowNumber, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const g of byLocation.values()) {
      try {
        const count = (await this.stockDocs.createCount(
          {
            countType: 'opening',
            storeId: g.storeId,
            locationId: g.locationId,
            remarks: 'Imported opening stock; check the totals, then finalise',
            lines: g.rows.map((r) => ({ itemId: r.itemId, countedQuantity: str(r.values.quantity)!, unitCost: str(r.values.cost)!, batchNumber: str(r.values.batch) ?? null, expiryDate: str(r.values.expiry) ?? null })),
          },
          ctx.actor,
          ctx.user,
        )) as { id: string; number?: string };
        for (const r of g.rows) out.set(r.rowNumber, { outcome: 'added', recordId: count.id, message: `In draft opening count ${count.number ?? ''}`.trim() });
      } catch (err) {
        for (const r of g.rows) out.set(r.rowNumber, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }

  private openingBills(): Importer {
    return {
      kind: 'opening_bills',
      importRight: 'import.opening',
      rights: ['journals.post'],
      fields: [
        { key: 'party', label: 'Customer or supplier', type: 'text', required: true, hint: 'customer or supplier' },
        { key: 'code', label: 'Party code', type: 'code', required: true },
        { key: 'number', label: 'Bill number', type: 'code', required: true },
        { key: 'date', label: 'Bill date', type: 'date', required: true },
        { key: 'due', label: 'Due date', type: 'date' },
        { key: 'amount', label: 'Amount still owed', type: 'number', required: true },
        { key: 'store', label: 'Store code', type: 'code' },
      ],
      example: ['customer', 'CUST-000001', 'OLD/101', '2026-08-01', '2026-08-31', 1200, 'MAIN'],
      keyOf: (v) => `${str(v.party)}|${str(v.code)}|${str(v.number)}`,
      apply: async (v, mode, ctx) => {
        const type = str(v.party)!.toLowerCase();
        if (type !== 'customer' && type !== 'supplier') throw new BadRequestException('Customer or supplier must say "customer" or "supplier"');
        const partyId = (await this.id(type === 'customer' ? 'Customer' : 'Supplier', str(v.code), (c): Promise<{ id: string } | null> => (type === 'customer' ? this.prisma.customer.findUnique({ where: { code: c } }) : this.prisma.supplier.findUnique({ where: { code: c } }))))!;
        const existing = await this.prisma.openingBill.findFirst({ where: { companyId: ctx.companyId, partyType: type, partyId, billNumber: str(v.number)!, status: 'posted' } });
        if (existing) return { outcome: 'unchanged', recordId: existing.id, message: 'Already there' };
        if (mode === 'change') throw new BadRequestException('Opening bills can only be added; cancel a wrong one on the Opening balances page');
        const storeId = await this.store(ctx.companyId, str(v.store));
        const r = await this.closing.createOpeningBill(
          { partyType: type, partyId, storeId: storeId ?? null, billNumber: str(v.number)!, billDate: str(v.date)!, dueDate: str(v.due) ?? null, amount: new Decimal(str(v.amount)!).abs().toFixed(2) },
          ctx.actor,
          ctx.user,
        );
        return { outcome: 'added', recordId: r.id };
      },
    };
  }
}
