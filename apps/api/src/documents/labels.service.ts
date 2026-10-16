// Copyright (c) 2026, Rademics. All rights reserved.
// Price and barcode labels (plan 10 §1.B; decision 73: standard templates with
// basic editing). The API works out what goes on each label, including the
// barcode bars; the browser lays them out on a sheet or roll and prints.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { barcodeModules, type BarcodeType, businessDate, type CurrentUser, Decimal, LABEL_SIZES, type LabelRequest, type LabelTemplateInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { canAccessStore } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { LabelTemplate } from '../generated/prisma/client.js';
import { MarkdownsService } from '../pricing/markdowns.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_LABELS = 2000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

const STANDARD_TEMPLATES: LabelTemplateInput[] = [
  { name: 'Shelf price label (A4, 65 per sheet)', sizeKey: 'a4-65', fields: ['name', 'price', 'mrp', 'barcode'], fontSize: 7, isDefault: true },
  { name: 'Product sticker (label roll 50 × 25 mm)', sizeKey: 'roll-50x25', fields: ['name', 'price', 'mrp', 'barcode', 'expiry'], fontSize: 8, isDefault: false },
];

@Injectable()
export class LabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly pricing: PricingService,
    private readonly markdowns: MarkdownsService,
  ) {}

  private size(input: LabelTemplateInput) {
    const preset = LABEL_SIZES.find((s) => s.key === input.sizeKey);
    if (preset) return { width: preset.width, height: preset.height, media: preset.media };
    if (input.sizeKey !== 'custom' || !input.width || !input.height || !input.media) throw new BadRequestException('Choose a label size, or give the width, height and sheet or roll');
    return { width: input.width, height: input.height, media: input.media };
  }

  async templates() {
    const company = await this.company.current();
    let rows = await this.prisma.labelTemplate.findMany({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    if (!rows.length) {
      await this.prisma.labelTemplate.createMany({ data: STANDARD_TEMPLATES.map((t) => ({ companyId: company.id, name: t.name, sizeKey: t.sizeKey, ...this.size(t), fields: t.fields, fontSize: t.fontSize, isDefault: t.isDefault })) });
      rows = await this.prisma.labelTemplate.findMany({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    }
    return { sizes: LABEL_SIZES, templates: rows.map((t) => this.dto(t)) };
  }

  async saveTemplate(id: string | null, input: LabelTemplateInput, actor: Actor) {
    const company = await this.company.current();
    const size = this.size(input);
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.labelTemplate.updateMany({ where: { companyId: company.id }, data: { isDefault: false } });
      const data = { name: input.name, sizeKey: input.sizeKey, width: size.width, height: size.height, media: size.media, fields: input.fields, fontSize: input.fontSize, isDefault: input.isDefault };
      if (id) {
        const before = await tx.labelTemplate.findUnique({ where: { id } });
        if (!before || before.companyId !== company.id) throw new NotFoundException('Label template not found');
        await tx.labelTemplate.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
      } else {
        id = (await tx.labelTemplate.create({ data: { companyId: company.id, ...data, createdById: actor.userId, updatedById: actor.userId } })).id;
      }
      await this.audit.record(tx, actor, { action: 'update', entityType: 'label_template', entityId: id, changes: { name: input.name, size: input.sizeKey, fields: input.fields } });
    });
    return this.templates();
  }

  /** What goes on each label, one entry per label to print. */
  async labels(req: LabelRequest, actor: Actor, user: CurrentUser) {
    const company = await this.company.current();
    const { templates } = await this.templates();
    const template = req.templateId ? templates.find((t) => t.id === req.templateId) : (templates.find((t) => t.isDefault) ?? templates[0]);
    if (!template) throw new BadRequestException('Label template not found');
    if (req.storeId && !canAccessStore(user, req.storeId)) throw new BadRequestException('You are not allowed to work in this store');
    const settings = await this.prisma.catalogueSettings.findFirst({ where: { companyId: company.id } });
    const priceListId = req.priceListId ?? settings?.defaultSellingPriceListId ?? null;
    const store = req.storeId ? await this.prisma.store.findUnique({ where: { id: req.storeId } }) : null;
    // Plan 11 C5: a markdown's labels show its new price and the price it replaced.
    const markedDown = new Map<string, { was: string | null; now: string }>();
    const wanted: { itemId: string; unitId?: string; copies: number; batch?: string | null; expiry?: string | null; packed?: string | null }[] = [];
    if (req.items?.length) wanted.push(...req.items.map((i) => ({ itemId: i.itemId, unitId: i.unitId, copies: i.copies })));
    else if (req.receiptId) {
      const r = await this.prisma.goodsReceipt.findUnique({ where: { id: req.receiptId }, include: { lines: true } });
      if (!r) throw new NotFoundException('Goods receipt not found');
      if (!canAccessStore(user, r.storeId)) throw new BadRequestException('You are not allowed to work in this store');
      const batches = new Map((await this.prisma.batch.findMany({ where: { id: { in: r.lines.map((l) => l.batchId).filter((x): x is string => !!x) } } })).map((b) => [b.id, b]));
      for (const l of r.lines) {
        // One label per basic unit accepted (a box of 10 pieces gives 10 labels).
        const copies = Math.floor(Number(new Decimal(l.basicAcceptedQuantity.toString()).abs().toString()));
        if (copies < 1) continue;
        const b = l.batchId ? batches.get(l.batchId) : null;
        wanted.push({ itemId: l.itemId, copies, batch: b?.batchNumber ?? l.newBatchNumber, expiry: iso(b?.expiryDate ?? l.newExpiryOn), packed: iso(b?.manufactureDate ?? l.newManufactureOn) });
      }
    } else if (req.markdownId) {
      const md = await this.markdowns.get(req.markdownId, user);
      for (const l of md.lines) {
        markedDown.set(l.itemId, { was: l.oldPrice, now: l.newPrice });
        wanted.push({ itemId: l.itemId, copies: 1 });
      }
    } else if (req.priceChangedSince) {
      if (!priceListId) throw new BadRequestException('Choose a price list');
      const today = businessDate();
      const changed = await this.prisma.price.findMany({
        where: { priceListId, customerId: null, supplierId: null, batchId: null, startDate: { gte: new Date(`${req.priceChangedSince}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
        select: { itemId: true, unitId: true },
        distinct: ['itemId', 'unitId'],
      });
      wanted.push(...changed.map((c) => ({ itemId: c.itemId, unitId: c.unitId, copies: 1 })));
    }
    const total = wanted.reduce((s, w) => s + w.copies, 0);
    if (total > MAX_LABELS) throw new BadRequestException(`That is ${total} labels; print at most ${MAX_LABELS} at a time`);
    const items = new Map((await this.prisma.item.findMany({ where: { id: { in: wanted.map((w) => w.itemId) } }, include: { barcodes: { where: { active: true }, orderBy: { createdAt: 'asc' } }, units: { include: { unit: true } } } })).map((i) => [i.id, i]));
    const labels = [];
    const today = businessDate();
    for (const w of wanted) {
      const item = items.get(w.itemId);
      if (!item) continue;
      const unitId = w.unitId ?? item.baseUnitId;
      const unit = item.units.find((u) => u.unitId === unitId);
      let price: string | null = null;
      if (priceListId) {
        const found = await this.pricing.lookup({ itemId: item.id, unitId, priceListId, date: today }, user).catch(() => null);
        if (found?.found && found.rate) price = new Decimal(found.rate).toFixed(2);
      }
      const md = unitId === item.baseUnitId ? markedDown.get(item.id) : undefined;
      if (md) price = md.now;
      const barcode = item.barcodes.find((b) => b.unitId === unitId) ?? item.barcodes.find((b) => !b.unitId && unitId === item.baseUnitId);
      let bars: ReturnType<typeof barcodeModules> | null = null;
      try {
        bars = barcode ? barcodeModules(barcode.code, barcode.type as BarcodeType) : barcodeModules(item.code, 'other');
      } catch {
        bars = barcodeModules(barcode?.code ?? item.code, 'other');
      }
      const mrp = unit?.mrp ?? (unitId === item.baseUnitId ? item.mrp : null);
      const label = {
        itemId: item.id,
        code: item.code,
        name: item.name,
        unit: unit?.unit.code ?? null,
        price,
        mrp: mrp ? new Decimal(mrp.toString()).toFixed(2) : null,
        barcode: bars,
        batch: w.batch ?? null,
        expiry: w.expiry ?? null,
        packed: w.packed ?? null,
        store: store?.name ?? null,
        wasPrice: md?.was && md.was !== price ? md.was : null,
      };
      for (let n = 0; n < w.copies; n++) labels.push(label);
    }
    await this.audit.record(this.prisma, actor, { action: 'print', entityType: 'labels', entityId: null, changes: { template: template.name, labels: labels.length } });
    return { template, labels };
  }

  private dto(t: LabelTemplate) {
    const preset = LABEL_SIZES.find((s) => s.key === t.sizeKey);
    return {
      id: t.id,
      name: t.name,
      sizeKey: t.sizeKey,
      width: Number(t.width.toString()),
      height: Number(t.height.toString()),
      media: t.media as 'sheet' | 'roll',
      across: preset?.across ?? null,
      down: preset?.down ?? null,
      marginTop: preset?.marginTop ?? null,
      marginLeft: preset?.marginLeft ?? null,
      gapX: preset?.gapX ?? null,
      gapY: preset?.gapY ?? null,
      fields: t.fields,
      fontSize: t.fontSize,
      isDefault: t.isDefault,
    };
  }
}
