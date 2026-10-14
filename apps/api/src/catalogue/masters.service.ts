// Copyright (c) 2026, Rademics. All rights reserved.
// Item groups, brands, HSN codes and variant attributes.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateAttributeInput,
  type CreateBrandInput,
  type CreateHsnCodeInput,
  type CreateItemGroupInput,
  Decimal,
  type UpdateAttributeInput,
  type UpdateBrandInput,
  type UpdateHsnCodeInput,
  type UpdateItemGroupInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { ItemGroup, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ItemGroupNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  hsnCode: string | null;
  active: boolean;
  isLeaf: boolean;
  children: ItemGroupNode[];
}

const attributeInclude = { values: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.VariantAttributeInclude;

@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Item groups (tree) ----

  async groupTree(): Promise<ItemGroupNode[]> {
    const rows = await this.prisma.itemGroup.findMany({ orderBy: [{ depth: 'asc' }, { name: 'asc' }] });
    const nodes = new Map<string, ItemGroupNode>();
    for (const r of rows) {
      nodes.set(r.id, { id: r.id, code: r.code, name: r.name, parentId: r.parentId, hsnCode: r.hsnCode, active: r.active, isLeaf: true, children: [] });
    }
    const roots: ItemGroupNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
        parent.isLeaf = false;
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async getGroup(db: Db, id: string): Promise<ItemGroup> {
    const group = await db.itemGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Item group not found');
    return group;
  }

  /** Only a lowest-level group may be given to items (blueprint 03). */
  async assertLeafGroup(db: Db, id: string): Promise<ItemGroup> {
    const group = await this.getGroup(db, id);
    if (!group.active) throw new BadRequestException(`Item group ${group.name} is switched off`);
    const children = await db.itemGroup.count({ where: { parentId: id } });
    if (children > 0) throw new BadRequestException(`${group.name} has sub-groups; choose one of them`);
    return group;
  }

  async createGroup(input: CreateItemGroupInput, actor: Actor) {
    if (await this.prisma.itemGroup.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`Item group ${input.code} already exists`);
    }
    const parent = input.parentId ? await this.getGroup(this.prisma, input.parentId) : null;
    if (parent) {
      const itemsInParent = await this.prisma.item.count({ where: { itemGroupId: parent.id } });
      if (itemsInParent > 0) throw new BadRequestException(`${parent.name} already has items; it cannot become a folder`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.itemGroup.create({
        data: {
          code: input.code,
          name: input.name,
          parentId: parent?.id ?? null,
          path: '',
          depth: parent ? parent.depth + 1 : 0,
          hsnCode: input.hsnCode ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      const path = `${parent?.path ?? '/'}${created.id}/`;
      const withPath = await tx.itemGroup.update({ where: { id: created.id }, data: { path } });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'item_group',
        entityId: created.id,
        changes: { code: created.code, name: created.name, parent: parent?.code ?? null },
      });
      return withPath;
    });
  }

  async updateGroup(id: string, input: UpdateItemGroupInput, actor: Actor) {
    const before = await this.getGroup(this.prisma, id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.itemGroup.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'item_group', id, before, after);
      return after;
    });
  }

  // ---- Brands ----

  listBrands() {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  async createBrand(input: CreateBrandInput, actor: Actor) {
    if (await this.prisma.brand.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`Brand ${input.code} already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({ data: { ...input, createdById: actor.userId, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'brand', entityId: created.id, changes: { code: created.code, name: created.name } });
      return created;
    });
  }

  async updateBrand(id: string, input: UpdateBrandInput, actor: Actor) {
    const before = await this.prisma.brand.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Brand not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.brand.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'brand', id, before, after);
      return after;
    });
  }

  // ---- HSN codes ----

  listHsnCodes(search?: string) {
    return this.prisma.hsnCode.findMany({
      where: search ? { OR: [{ code: { startsWith: search } }, { description: { contains: search, mode: 'insensitive' } }] } : {},
      orderBy: { code: 'asc' },
      take: 200,
    });
  }

  async createHsnCode(input: CreateHsnCodeInput, actor: Actor) {
    if (await this.prisma.hsnCode.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`HSN code ${input.code} already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.hsnCode.create({
        data: { code: input.code, description: input.description, isService: input.isService ?? false, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'hsn_code', entityId: created.id, changes: { code: created.code } });
      return created;
    });
  }

  async updateHsnCode(id: string, input: UpdateHsnCodeInput, actor: Actor) {
    const before = await this.prisma.hsnCode.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('HSN code not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.hsnCode.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'hsn_code', id, before, after);
      return after;
    });
  }

  // ---- Variant attributes ----

  listAttributes() {
    return this.prisma.variantAttribute.findMany({ include: attributeInclude, orderBy: { name: 'asc' } });
  }

  async getAttribute(db: Db, id: string) {
    const attribute = await db.variantAttribute.findUnique({ where: { id }, include: attributeInclude });
    if (!attribute) throw new NotFoundException('Attribute not found');
    return attribute;
  }

  async createAttribute(input: CreateAttributeInput, actor: Actor) {
    if (await this.prisma.variantAttribute.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`Attribute ${input.code} already exists`);
    }
    if (input.kind === 'numeric') {
      if (!(input.rangeStart! < input.rangeEnd!)) throw new BadRequestException('Range start must be below its end');
      if (!(input.rangeStep! > 0)) throw new BadRequestException('Step must be above zero');
    }
    const values = this.uniqueValues(input.values ?? []);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.variantAttribute.create({
        data: {
          code: input.code,
          name: input.name,
          kind: input.kind,
          rangeStart: input.rangeStart != null ? new Decimal(input.rangeStart) : null,
          rangeEnd: input.rangeEnd != null ? new Decimal(input.rangeEnd) : null,
          rangeStep: input.rangeStep != null ? new Decimal(input.rangeStep) : null,
          values: { create: values },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: attributeInclude,
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'variant_attribute',
        entityId: created.id,
        changes: { code: created.code, kind: created.kind, values: values.map((v) => v.value) },
      });
      return created;
    });
  }

  async updateAttribute(id: string, input: UpdateAttributeInput, actor: Actor) {
    const before = await this.getAttribute(this.prisma, id);
    const values = input.values ? this.uniqueValues(input.values) : null;
    if (values) {
      // Values in use by variants cannot be removed or renamed (blueprint 03).
      const inUse = await this.prisma.itemVariantValue.findMany({ where: { attributeId: id }, distinct: ['value'], select: { value: true } });
      const kept = new Set(values.map((v) => v.valueKey));
      const missing = inUse.filter((u) => !kept.has(u.value.toLowerCase())).map((u) => u.value);
      if (missing.length) throw new BadRequestException(`Values in use by variants cannot be removed: ${missing.join(', ')}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.variantAttribute.update({
        where: { id },
        data: {
          name: input.name,
          active: input.active,
          updatedById: actor.userId,
          ...(values ? { values: { deleteMany: {}, create: values } } : {}),
        },
        include: attributeInclude,
      });
      const { values: bv, ...b } = before;
      const { values: av, ...a } = after;
      await this.audit.recordUpdate(tx, actor, 'variant_attribute', id, { ...b, values: bv.map((v) => v.value) }, { ...a, values: av.map((v) => v.value) });
      return after;
    });
  }

  private uniqueValues(values: { value: string; shortCode: string }[]) {
    const seenValue = new Set<string>();
    const seenCode = new Set<string>();
    return values.map((v, i) => {
      const valueKey = v.value.toLowerCase();
      if (seenValue.has(valueKey)) throw new BadRequestException(`Value "${v.value}" is listed twice`);
      if (seenCode.has(v.shortCode)) throw new BadRequestException(`Short code "${v.shortCode}" is listed twice`);
      seenValue.add(valueKey);
      seenCode.add(v.shortCode);
      return { value: v.value, valueKey, shortCode: v.shortCode, sortOrder: i };
    });
  }
}
