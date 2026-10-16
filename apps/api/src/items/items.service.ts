// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttributeValueChoice,
  barcodeProblem,
  businessDate,
  type CreateBarcodeInput,
  type CreateItemInput,
  type CreateVariantsInput,
  type CurrentUser,
  Decimal,
  guessBarcodeType,
  hasPermission,
  type ItemQuery,
  numericValueProblem,
  type SetItemUnitsInput,
  STYLE_FIELDS_FOR_VARIANTS,
  type UpdateBarcodeInput,
  type UpdateItemInput,
  variantCombinations,
  variantValuesKey,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { CatalogueSettingsService, ITEM_NUMBER_SERIES } from '../catalogue/catalogue-settings.service.js';
import { MastersService } from '../catalogue/masters.service.js';
import { UnitsService } from '../catalogue/units.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Item, Prisma } from '../generated/prisma/client.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SeasonsService } from './seasons.service.js';

export const itemInclude = {
  itemGroup: { select: { id: true, code: true, name: true } },
  brand: { select: { id: true, code: true, name: true } },
  baseUnit: { select: { id: true, code: true, name: true, allowsFractions: true } },
  parent: { select: { id: true, code: true, name: true } },
  units: { include: { unit: { select: { id: true, code: true, name: true, allowsFractions: true } } } },
  barcodes: { include: { unit: { select: { id: true, code: true } } }, orderBy: { createdAt: 'asc' } },
  variantAttributes: { include: { attribute: { select: { id: true, code: true, name: true } } }, orderBy: { sortOrder: 'asc' } },
  variantValues: { include: { attribute: { select: { id: true, code: true, name: true } } } },
  _count: { select: { variants: true } },
} satisfies Prisma.ItemInclude;

export type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

const MAX_IMAGE_BYTES = 500 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const dec = (v: Decimal | null | undefined) => (v == null ? null : v.toString());
const date = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly masters: MastersService,
    private readonly units: UnitsService,
    private readonly settings: CatalogueSettingsService,
    private readonly numbering: NumberingService,
    private readonly seasons: SeasonsService,
  ) {}

  // ---- Reading ----

  async list(q: ItemQuery, user: CurrentUser) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.ItemWhereInput = {
      ...(q.groupId ? { itemGroupId: q.groupId } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.seasonId ? { seasonId: q.seasonId } : {}),
      ...(q.kind === 'stock' ? { isStockItem: true, isParentStyle: false } : {}),
      ...(q.kind === 'service' ? { isStockItem: false, isParentStyle: false } : {}),
      ...(q.kind === 'style' ? { isParentStyle: true } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search.toUpperCase() } },
              { name: { contains: q.search, mode: 'insensitive' } },
              { barcodes: { some: { code: q.search } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.item.findMany({ where, include: itemInclude, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.item.count({ where }),
    ]);
    return { rows: rows.map((r) => this.toDto(r, user)), total, page, pageSize };
  }

  async getRow(db: Db, id: string): Promise<ItemRow> {
    const item = await db.item.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async get(id: string, user: CurrentUser) {
    return this.toDto(await this.getRow(this.prisma, id), user);
  }

  /** Decision 70: cost figures only for users with cost_price.view. */
  toDto(item: ItemRow, user: CurrentUser) {
    const showCost = hasPermission(user, 'cost_price.view');
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      hasImage: item.imageMimeType !== null,
      itemGroup: item.itemGroup,
      brand: item.brand,
      seasonId: item.seasonId,
      baseUnit: item.baseUnit,
      hsnCode: item.hsnCode,
      mrp: dec(item.mrp),
      maxDiscountPercent: item.maxDiscountPercent.toString(),
      isStockItem: item.isStockItem,
      canBuy: item.canBuy,
      canSell: item.canSell,
      endDate: date(item.endDate),
      active: item.active,
      isParentStyle: item.isParentStyle,
      parent: item.parent,
      variantCount: item._count.variants,
      trackBatches: item.trackBatches,
      autoNumberBatches: item.autoNumberBatches,
      shelfLifeDays: item.shelfLifeDays,
      trackSerials: item.trackSerials,
      warrantyDays: item.warrantyDays,
      ...(showCost ? { lastPurchasePrice: dec(item.lastPurchasePrice) } : {}),
      units: item.units.map((u) => ({ unitId: u.unitId, code: u.unit.code, name: u.unit.name, allowsFractions: u.unit.allowsFractions, factor: u.factor.toString(), mrp: dec(u.mrp) })),
      barcodes: item.barcodes.map((b) => ({ id: b.id, code: b.code, type: b.type, unit: b.unit, active: b.active })),
      variantAttributes: item.variantAttributes.map((a) => a.attribute),
      variantValues: item.variantValues.map((v) => ({ attribute: v.attribute, value: v.value, shortCode: v.shortCode })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /** Why an item cannot be used on a document today, or null when it can. */
  usabilityProblem(item: Pick<Item, 'active' | 'endDate' | 'isParentStyle' | 'canSell' | 'canBuy' | 'isStockItem'>, purpose: 'sale' | 'purchase' | 'stock' | 'any' = 'any'): string | null {
    if (!item.active) return 'switched off';
    if (item.isParentStyle) return 'a style; choose one of its variants';
    if (item.endDate && date(item.endDate)! < businessDate()) return `not available after ${date(item.endDate)}`;
    if (purpose === 'sale' && !item.canSell) return 'not for sale';
    if (purpose === 'purchase' && !item.canBuy) return 'not for purchase';
    if (purpose === 'stock' && !item.isStockItem) return 'not a stock item';
    return null;
  }

  /** For later modules: throws when the item cannot be used on a document. */
  async assertItemUsable(db: Db, itemId: string, purpose: 'sale' | 'purchase' | 'stock' | 'any' = 'any'): Promise<Item> {
    const item = await db.item.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');
    const problem = this.usabilityProblem(item, purpose);
    if (problem) throw new BadRequestException(`Item ${item.code} is ${problem}`);
    return item;
  }

  /** assertItemUsable for many items at once (plan 11 A5: counts and imports of thousands of lines). */
  async assertItemsUsable(db: Db, itemIds: string[], purpose: 'sale' | 'purchase' | 'stock' | 'any' = 'any'): Promise<Map<string, Item>> {
    const byId = new Map((await db.item.findMany({ where: { id: { in: [...new Set(itemIds)] } } })).map((i) => [i.id, i]));
    for (const id of itemIds) {
      const item = byId.get(id);
      if (!item) throw new NotFoundException('Item not found');
      const problem = this.usabilityProblem(item, purpose);
      if (problem) throw new BadRequestException(`Item ${item.code} is ${problem}`);
    }
    return byId;
  }

  /** Scan box: exact barcode, else exact item code. */
  async scan(code: string, user: CurrentUser) {
    const trimmed = code.trim();
    const barcode = await this.prisma.barcode.findUnique({ where: { code: trimmed }, include: { item: { include: itemInclude } } });
    let item: ItemRow | null = barcode?.item ?? null;
    let unitId = barcode?.unitId ?? null;
    if (!item) {
      item = await this.prisma.item.findUnique({ where: { code: trimmed.toUpperCase() }, include: itemInclude });
    }
    if (!item) throw new NotFoundException(`Nothing found for "${trimmed}"`);
    if (barcode && !barcode.active) throw new NotFoundException(`Barcode ${trimmed} is switched off`);
    unitId ??= item.baseUnitId;
    const unitRow = item.units.find((u) => u.unitId === unitId) ?? item.units.find((u) => u.unitId === item!.baseUnitId)!;
    const problem = this.usabilityProblem(item);
    return {
      item: this.toDto(item, user),
      unit: { id: unitRow.unitId, code: unitRow.unit.code, name: unitRow.unit.name, factor: unitRow.factor.toString() },
      matchedBy: barcode ? 'barcode' : 'code',
      usable: problem === null,
      reason: problem,
    };
  }

  // ---- Creating and changing ----

  async create(input: CreateItemInput, actor: Actor, user: CurrentUser) {
    const company = await this.company.current();
    const settings = await this.settings.get();
    const group = await this.masters.assertLeafGroup(this.prisma, input.itemGroupId);
    const baseUnit = await this.units.get(this.prisma, input.baseUnitId);
    if (!baseUnit.active) throw new BadRequestException(`Unit ${baseUnit.code} is switched off`);
    if (input.brandId && !(await this.prisma.brand.findFirst({ where: { id: input.brandId, active: true } }))) {
      throw new BadRequestException('Brand not found or switched off');
    }
    this.checkFlags(input);
    if (input.seasonId) await this.seasons.assertUsable(this.prisma, input.seasonId);
    const isParentStyle = (input.variantAttributeIds?.length ?? 0) > 0;
    if (isParentStyle) {
      const attrs = await this.prisma.variantAttribute.findMany({ where: { id: { in: input.variantAttributeIds }, active: true } });
      if (attrs.length !== new Set(input.variantAttributeIds).size) throw new BadRequestException('One or more attributes do not exist');
    }
    if (input.code && (await this.prisma.item.findUnique({ where: { code: input.code } }))) {
      throw new ConflictException(`Item code ${input.code} already exists`);
    }
    if (!input.code && !settings.autoItemCodes) throw new BadRequestException('Item code is required');
    const extraUnits = await this.checkUnits(this.prisma, baseUnit.id, input.units ?? []);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = input.code ?? (await this.numbering.allocate(tx, { companyId: company.id, documentKind: ITEM_NUMBER_SERIES.documentKind }));
      const item = await tx.item.create({
        data: {
          code,
          name: input.name,
          description: input.description ?? null,
          itemGroupId: group.id,
          brandId: input.brandId ?? null,
          seasonId: input.seasonId ?? null,
          baseUnitId: baseUnit.id,
          hsnCode: input.hsnCode ?? group.hsnCode ?? null,
          mrp: input.mrp != null ? new Decimal(input.mrp) : null,
          maxDiscountPercent: new Decimal(input.maxDiscountPercent ?? '0'),
          isStockItem: input.isStockItem ?? true,
          canBuy: input.canBuy ?? true,
          canSell: input.canSell ?? true,
          endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null,
          isParentStyle,
          trackBatches: input.trackBatches ?? false,
          autoNumberBatches: input.autoNumberBatches ?? false,
          shelfLifeDays: input.shelfLifeDays ?? null,
          trackSerials: input.trackSerials ?? false,
          warrantyDays: input.warrantyDays ?? null,
          units: { create: [{ unitId: baseUnit.id, factor: new Decimal(1) }, ...extraUnits] },
          variantAttributes: isParentStyle
            ? { create: input.variantAttributeIds!.map((attributeId, i) => ({ attributeId, sortOrder: i })) }
            : undefined,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: itemInclude,
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'item',
        entityId: item.id,
        changes: { code: item.code, name: item.name, group: group.code, baseUnit: baseUnit.code, isParentStyle },
      });
      if (input.sellingPrice != null && !isParentStyle) {
        if (!settings.defaultSellingPriceListId) throw new BadRequestException('No default selling price list is set');
        const price = await tx.price.create({
          data: {
            priceListId: settings.defaultSellingPriceListId,
            itemId: item.id,
            unitId: baseUnit.id,
            price: new Decimal(input.sellingPrice),
            startDate: new Date(`${businessDate()}T00:00:00Z`),
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'price',
          entityId: price.id,
          changes: { item: item.code, unit: baseUnit.code, price: input.sellingPrice },
        });
      }
      return item;
    });
    return this.toDto(created, user);
  }

  async update(id: string, input: UpdateItemInput, actor: Actor, user: CurrentUser) {
    const before = await this.getRow(this.prisma, id);
    this.checkFlags({ ...before, ...input, isStockItem: input.isStockItem ?? before.isStockItem, trackSerials: input.trackSerials ?? before.trackSerials });
    if (input.itemGroupId && input.itemGroupId !== before.itemGroupId) await this.masters.assertLeafGroup(this.prisma, input.itemGroupId);
    if (input.brandId && !(await this.prisma.brand.findFirst({ where: { id: input.brandId, active: true } }))) {
      throw new BadRequestException('Brand not found or switched off');
    }
    if (input.seasonId && input.seasonId !== before.seasonId) await this.seasons.assertUsable(this.prisma, input.seasonId);
    if (input.applyToVariants && !before.isParentStyle) throw new BadRequestException(`${before.code} is not a style with sizes and colours`);
    const baseUnitChanged = !!input.baseUnitId && input.baseUnitId !== before.baseUnitId;
    // Plan 11 A1: once stock has moved, these would change the meaning of every past quantity.
    const changed = [
      baseUnitChanged && 'basic unit',
      input.trackBatches !== undefined && input.trackBatches !== before.trackBatches && 'batch tracking',
      input.trackSerials !== undefined && input.trackSerials !== before.trackSerials && 'serial number tracking',
      input.isStockItem !== undefined && input.isStockItem !== before.isStockItem && 'stock item or service',
    ].filter((c): c is string => !!c);
    if (changed.length && (await this.prisma.stockLedgerEntry.count({ where: { itemId: id }, take: 1 }))) {
      throw new BadRequestException(`${before.code} already has stock movements, so its ${changed.join(', ')} cannot change. Create a new item instead.`);
    }
    if (baseUnitChanged) {
      // Allowed only while the item has never had stock (checked above); the unit list is cleared.
      const unit = await this.units.get(this.prisma, input.baseUnitId!);
      if (!unit.active) throw new BadRequestException(`Unit ${unit.code} is switched off`);
      const pricedInOtherUnits = await this.prisma.price.count({ where: { itemId: id, unitId: { not: input.baseUnitId } } });
      if (pricedInOtherUnits > 0) throw new BadRequestException('End the prices in the old units before changing the basic unit');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.item.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          itemGroupId: input.itemGroupId,
          brandId: input.brandId,
          seasonId: input.seasonId,
          baseUnitId: input.baseUnitId,
          hsnCode: input.hsnCode,
          mrp: input.mrp === undefined ? undefined : input.mrp === null ? null : new Decimal(input.mrp),
          maxDiscountPercent: input.maxDiscountPercent === undefined ? undefined : new Decimal(input.maxDiscountPercent),
          isStockItem: input.isStockItem,
          canBuy: input.canBuy,
          canSell: input.canSell,
          endDate: input.endDate === undefined ? undefined : input.endDate === null ? null : new Date(`${input.endDate}T00:00:00Z`),
          active: input.active,
          trackBatches: input.trackBatches,
          autoNumberBatches: input.autoNumberBatches,
          shelfLifeDays: input.shelfLifeDays,
          trackSerials: input.trackSerials,
          warrantyDays: input.warrantyDays,
          updatedById: actor.userId,
          ...(baseUnitChanged ? { units: { deleteMany: {}, create: [{ unitId: input.baseUnitId!, factor: new Decimal(1) }] } } : {}),
        },
        include: itemInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'item', id, summarise(before), summarise(after));
      if (input.applyToVariants) {
        const fields = STYLE_FIELDS_FOR_VARIANTS.filter((f) => input[f] !== undefined);
        await this.copyToVariants(tx, after, fields, actor);
      }
      return after;
    });
    return this.toDto(updated, user);
  }

  /** Plan 11 B2: copies the style's MRP, HSN, brand, group, maximum discount, description and season to all its variants. */
  async applyToVariants(id: string, actor: Actor) {
    const style = await this.getRow(this.prisma, id);
    if (!style.isParentStyle) throw new BadRequestException(`${style.code} is not a style with sizes and colours`);
    const changed = await this.prisma.$transaction((tx) => this.copyToVariants(tx, style, [...STYLE_FIELDS_FOR_VARIANTS], actor));
    return { variants: style._count.variants, changed };
  }

  /**
   * Copies the given style fields to every variant, in the style's transaction.
   * Codes, barcodes, prices, units and tracking are never copied; each variant
   * that changes gets its own history row.
   */
  private async copyToVariants(tx: Db, style: Item, fields: (typeof STYLE_FIELDS_FOR_VARIANTS)[number][], actor: Actor): Promise<number> {
    if (!fields.length) return 0;
    const data = Object.fromEntries(fields.map((f) => [f, style[f]])) as Prisma.ItemUncheckedUpdateInput;
    const variants = await tx.item.findMany({ where: { parentItemId: style.id }, include: itemInclude, orderBy: { code: 'asc' } });
    let changed = 0;
    for (const v of variants) {
      if (fields.every((f) => sameValue(v[f], style[f]))) continue;
      const after = await tx.item.update({ where: { id: v.id }, data: { ...data, updatedById: actor.userId }, include: itemInclude });
      await this.audit.recordUpdate(tx, actor, 'item', v.id, summarise(v), summarise(after), `Copied from style ${style.code}`);
      changed++;
    }
    return changed;
  }

  async setUnits(id: string, input: SetItemUnitsInput, actor: Actor, user: CurrentUser) {
    const before = await this.getRow(this.prisma, id);
    const extra = await this.checkUnits(this.prisma, before.baseUnitId, input.units.filter((u) => u.unitId !== before.baseUnitId));
    const baseMrp = input.units.find((u) => u.unitId === before.baseUnitId)?.mrp;
    const removed = before.units.filter((u) => u.unitId !== before.baseUnitId && !extra.some((e) => e.unitId === u.unitId));
    for (const r of removed) {
      if (await this.prisma.price.count({ where: { itemId: id, unitId: r.unitId } })) {
        throw new BadRequestException(`Unit ${r.unit.code} still has prices; end them first`);
      }
      if (await this.prisma.barcode.count({ where: { itemId: id, unitId: r.unitId } })) {
        throw new BadRequestException(`Unit ${r.unit.code} still has barcodes; remove them first`);
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.item.update({
        where: { id },
        data: {
          updatedById: actor.userId,
          units: {
            deleteMany: {},
            create: [{ unitId: before.baseUnitId, factor: new Decimal(1), mrp: baseMrp != null ? new Decimal(baseMrp) : null }, ...extra],
          },
        },
        include: itemInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'item', id, { units: unitSummary(before) }, { units: unitSummary(after) });
      return after;
    });
    return this.toDto(updated, user);
  }

  // ---- Barcodes ----

  async addBarcode(itemId: string, input: CreateBarcodeInput, actor: Actor) {
    const item = await this.getRow(this.prisma, itemId);
    if (item.isParentStyle) throw new BadRequestException('Barcodes belong to variants, not to the style');
    const type = input.type ?? guessBarcodeType(input.code);
    const problem = barcodeProblem(input.code, type);
    if (problem) throw new BadRequestException(problem);
    const existing = await this.prisma.barcode.findUnique({ where: { code: input.code }, include: { item: { select: { code: true, name: true } } } });
    if (existing) throw new ConflictException(`Barcode ${input.code} already belongs to ${existing.item.code} (${existing.item.name})`);
    if (input.unitId && !item.units.some((u) => u.unitId === input.unitId)) {
      throw new BadRequestException('The barcode unit must be one of the item’s units');
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.barcode.create({
        data: { code: input.code, itemId, unitId: input.unitId ?? null, type, createdById: actor.userId, updatedById: actor.userId },
        include: { unit: { select: { id: true, code: true } } },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'barcode', entityId: created.id, changes: { item: item.code, code: created.code, type } });
      return created;
    });
  }

  async updateBarcode(itemId: string, barcodeId: string, input: UpdateBarcodeInput, actor: Actor) {
    const item = await this.getRow(this.prisma, itemId);
    const before = item.barcodes.find((b) => b.id === barcodeId);
    if (!before) throw new NotFoundException('Barcode not found');
    if (input.unitId && !item.units.some((u) => u.unitId === input.unitId)) {
      throw new BadRequestException('The barcode unit must be one of the item’s units');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.barcode.update({ where: { id: barcodeId }, data: { ...input, updatedById: actor.userId }, include: { unit: { select: { id: true, code: true } } } });
      await this.audit.recordUpdate(tx, actor, 'barcode', barcodeId, { unitId: before.unitId, active: before.active }, { unitId: after.unitId, active: after.active });
      return after;
    });
  }

  // ---- Variants ----

  async listVariants(parentId: string, user: CurrentUser) {
    await this.getRow(this.prisma, parentId);
    const rows = await this.prisma.item.findMany({ where: { parentItemId: parentId }, include: itemInclude, orderBy: { code: 'asc' } });
    return rows.map((r) => this.toDto(r, user));
  }

  async createVariants(parentId: string, input: CreateVariantsInput, actor: Actor, user: CurrentUser) {
    const parent = await this.getRow(this.prisma, parentId);
    if (!parent.isParentStyle) throw new BadRequestException(`${parent.code} is not a style with variants`);
    const choices: AttributeValueChoice[] = [];
    for (const pa of parent.variantAttributes) {
      const wanted = input.values[pa.attributeId];
      if (!wanted?.length) throw new BadRequestException(`Choose at least one value for ${pa.attribute.name}`);
      const attribute = await this.masters.getAttribute(this.prisma, pa.attributeId);
      const values: AttributeValueChoice['values'] = [];
      for (const w of wanted) {
        if (attribute.kind === 'list') {
          const match = attribute.values.find((v) => v.valueKey === w.toLowerCase());
          if (!match) throw new BadRequestException(`"${w}" is not a value of ${attribute.name}`);
          values.push({ value: match.value, shortCode: match.shortCode });
        } else {
          const n = Number(w);
          const problem = Number.isFinite(n)
            ? numericValueProblem(n, { start: Number(attribute.rangeStart), end: Number(attribute.rangeEnd), step: Number(attribute.rangeStep) })
            : 'Must be a number';
          if (problem) throw new BadRequestException(`${attribute.name}: ${problem}`);
          values.push({ value: String(n), shortCode: String(n) });
        }
      }
      choices.push({ attributeId: pa.attributeId, values });
    }
    const unknown = Object.keys(input.values).filter((id) => !parent.variantAttributes.some((a) => a.attributeId === id));
    if (unknown.length) throw new BadRequestException('Values given for an attribute the style does not vary by');

    let combos;
    try {
      combos = variantCombinations(parent.code, parent.name, choices);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const existingKeys = new Set((await this.prisma.item.findMany({ where: { parentItemId: parentId }, select: { variantKey: true } })).map((v) => v.variantKey));
    const extraUnits = parent.units.filter((u) => u.unitId !== parent.baseUnitId).map((u) => ({ unitId: u.unitId, factor: u.factor, mrp: u.mrp }));

    const created = await this.prisma.$transaction(async (tx) => {
      const out: ItemRow[] = [];
      for (const combo of combos) {
        const variantKey = variantValuesKey(combo.values);
        if (existingKeys.has(variantKey)) continue;
        if (await tx.item.findUnique({ where: { code: combo.code } })) {
          throw new ConflictException(`Item code ${combo.code} already exists`);
        }
        const variant = await tx.item.create({
          data: {
            code: combo.code,
            name: combo.name,
            description: parent.description,
            itemGroupId: parent.itemGroupId,
            brandId: parent.brandId,
            seasonId: parent.seasonId,
            baseUnitId: parent.baseUnitId,
            hsnCode: parent.hsnCode,
            mrp: parent.mrp,
            maxDiscountPercent: parent.maxDiscountPercent,
            isStockItem: parent.isStockItem,
            canBuy: parent.canBuy,
            canSell: parent.canSell,
            trackBatches: parent.trackBatches,
            autoNumberBatches: parent.autoNumberBatches,
            shelfLifeDays: parent.shelfLifeDays,
            trackSerials: parent.trackSerials,
            warrantyDays: parent.warrantyDays,
            parentItemId: parent.id,
            variantKey,
            units: { create: [{ unitId: parent.baseUnitId, factor: new Decimal(1) }, ...extraUnits] },
            variantValues: { create: combo.values.map((v) => ({ attributeId: v.attributeId, value: v.value, shortCode: v.shortCode })) },
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include: itemInclude,
        });
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'item',
          entityId: variant.id,
          changes: { code: variant.code, name: variant.name, parent: parent.code, values: combo.values.map((v) => v.value) },
        });
        out.push(variant);
      }
      return out;
    });
    return { created: created.map((v) => this.toDto(v, user)), skippedExisting: combos.length - created.length };
  }

  // ---- Pictures ----

  async setImage(id: string, mimeType: string, dataBase64: string, actor: Actor) {
    await this.getRow(this.prisma, id);
    if (!IMAGE_TYPES.has(mimeType)) throw new BadRequestException('Picture must be JPEG, PNG or WebP');
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('Picture is empty');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BadRequestException('Picture must be 500 KB or smaller');
    await this.prisma.$transaction(async (tx) => {
      await tx.item.update({ where: { id }, data: { image: bytes, imageMimeType: mimeType, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'item', entityId: id, changes: { image: { old: null, new: `${mimeType}, ${bytes.length} bytes` } } });
    });
  }

  async getImage(id: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    const item = await this.prisma.item.findUnique({ where: { id }, select: { image: true, imageMimeType: true } });
    if (!item?.image || !item.imageMimeType) throw new NotFoundException('No picture');
    return { mimeType: item.imageMimeType, bytes: item.image };
  }

  async deleteImage(id: string, actor: Actor) {
    await this.getRow(this.prisma, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.item.update({ where: { id }, data: { image: null, imageMimeType: null, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'item', entityId: id, changes: { image: { old: 'picture', new: null } } });
    });
  }

  // ---- Helpers ----

  private checkFlags(input: { isStockItem?: boolean | null; trackSerials?: boolean | null; trackBatches?: boolean | null; autoNumberBatches?: boolean | null; shelfLifeDays?: number | null }) {
    const isStock = input.isStockItem ?? true;
    if (!isStock && input.trackSerials) throw new BadRequestException('Serial tracking is only possible for stock items');
    if (!isStock && input.trackBatches) throw new BadRequestException('Batch tracking is only possible for stock items');
    if (input.autoNumberBatches && !input.trackBatches) throw new BadRequestException('Automatic batch numbers need batch tracking');
  }

  /** Validates extra units (not the basic one) and returns rows to create. */
  private async checkUnits(db: Db, baseUnitId: string, units: { unitId: string; factor: string; mrp?: string | null }[]) {
    const seen = new Set<string>([baseUnitId]);
    const rows: { unitId: string; factor: Decimal; mrp: Decimal | null }[] = [];
    for (const u of units) {
      if (u.unitId === baseUnitId) {
        if (new Decimal(u.factor).eq(1)) continue;
        throw new BadRequestException('The basic unit always has a factor of 1');
      }
      if (seen.has(u.unitId)) throw new BadRequestException('A unit may appear only once');
      seen.add(u.unitId);
      const unit = await this.units.get(db, u.unitId);
      if (!unit.active) throw new BadRequestException(`Unit ${unit.code} is switched off`);
      const factor = new Decimal(u.factor);
      if (factor.lte(0)) throw new BadRequestException(`Factor for ${unit.code} must be above zero`);
      rows.push({ unitId: unit.id, factor, mrp: u.mrp != null ? new Decimal(u.mrp) : null });
    }
    return rows;
  }
}

function summarise(item: ItemRow): Record<string, unknown> {
  return {
    name: item.name,
    description: item.description,
    itemGroup: item.itemGroup.code,
    brand: item.brand?.code ?? null,
    seasonId: item.seasonId,
    baseUnit: item.baseUnit.code,
    hsnCode: item.hsnCode,
    mrp: dec(item.mrp),
    maxDiscountPercent: item.maxDiscountPercent.toString(),
    isStockItem: item.isStockItem,
    canBuy: item.canBuy,
    canSell: item.canSell,
    endDate: date(item.endDate),
    active: item.active,
    trackBatches: item.trackBatches,
    autoNumberBatches: item.autoNumberBatches,
    shelfLifeDays: item.shelfLifeDays,
    trackSerials: item.trackSerials,
    warrantyDays: item.warrantyDays,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  // Decimals compare by value; everything else copied is a string.
  if (Decimal.isDecimal(a) || Decimal.isDecimal(b)) return new Decimal((a as Decimal).toString()).eq((b as Decimal).toString());
  return a === b;
}

function unitSummary(item: ItemRow): string[] {
  return item.units.map((u) => `${u.unit.code}=${u.factor.toString()}${u.mrp ? ` (MRP ${u.mrp.toString()})` : ''}`).sort();
}
