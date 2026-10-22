// Copyright (c) 2026, Rademics. All rights reserved.
// Stock locations, reorder levels and inventory settings.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateLocationInput,
  type CurrentUser,
  Decimal,
  type ReorderLevelInput,
  type UpdateInventorySettingsInput,
  type UpdateLocationInput,
} from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class InventoryMastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  /** Stores created before module 4 get their locations on the first start. */

  // ---- Locations ----

  async listLocations(user: CurrentUser) {
    const company = await this.company.current();
    const ids = allowedStoreIds(user);
    const rows = await this.prisma.stockLocation.findMany({
      where: { companyId: company.id, ...(ids ? { OR: [{ storeId: { in: ids } }, { kind: 'transit' }] } : {}) },
      include: { store: { select: { id: true, code: true, name: true } } },
      orderBy: [{ storeId: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, parentId: r.parentId, store: r.store, active: r.active }));
  }

  async createLocation(input: CreateLocationInput, actor: Actor, user: CurrentUser) {
    assertStoreAccess(user, input.storeId);
    const company = await this.company.current();
    const store = await this.prisma.store.findFirst({ where: { id: input.storeId, companyId: company.id } });
    if (!store) throw new NotFoundException('Store not found');
    if (await this.prisma.stockLocation.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) {
      throw new ConflictException(`Location ${input.code} already exists`);
    }
    let parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.prisma.stockLocation.findUnique({ where: { id: parentId } });
      if (!parent || parent.storeId !== store.id || parent.kind !== 'folder') throw new BadRequestException('The parent must be a folder of the same store');
    } else {
      parentId = (await this.prisma.stockLocation.findUnique({ where: { companyId_code: { companyId: company.id, code: store.code } } }))?.id ?? null;
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.stockLocation.create({
        data: { companyId: company.id, storeId: store.id, parentId, code: input.code, name: input.name, kind: input.kind, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'stock_location', entityId: created.id, changes: { code: created.code, name: created.name, kind: created.kind, store: store.code } });
      return created;
    });
  }

  async updateLocation(id: string, input: UpdateLocationInput, actor: Actor, user: CurrentUser) {
    const before = await this.prisma.stockLocation.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Location not found');
    if (before.storeId) assertStoreAccess(user, before.storeId);
    if (input.active === false) {
      if (before.kind === 'transit') throw new BadRequestException('The transit location cannot be switched off');
      const stock = await this.prisma.stockPosition.findFirst({ where: { locationId: id, NOT: { quantity: 0 } } });
      if (stock) throw new BadRequestException('This location still holds stock; move it out first');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.stockLocation.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'stock_location', id, before, after);
      return after;
    });
  }

  // ---- Reorder levels (used by module 5) ----

  async listReorder(storeId: string | undefined, user: CurrentUser) {
    const ids = allowedStoreIds(user);
    if (storeId) assertStoreAccess(user, storeId);
    const rows = await this.prisma.reorderLevel.findMany({
      where: storeId ? { storeId } : ids ? { storeId: { in: ids } } : {},
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ ...r, level: r.level.toString(), quantity: r.quantity.toString() }));
  }

  async setReorder(input: ReorderLevelInput, actor: Actor, user: CurrentUser) {
    assertStoreAccess(user, input.storeId);
    const item = await this.prisma.item.findUnique({ where: { id: input.itemId } });
    if (!item || !item.isStockItem || item.isParentStyle) throw new BadRequestException('Reorder levels are for stock items (variants, not styles)');
    const before = await this.prisma.reorderLevel.findUnique({ where: { itemId_storeId: { itemId: input.itemId, storeId: input.storeId } } });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.reorderLevel.upsert({
        where: { itemId_storeId: { itemId: input.itemId, storeId: input.storeId } },
        create: {
          itemId: input.itemId,
          storeId: input.storeId,
          level: new Decimal(input.level).toString(),
          quantity: new Decimal(input.quantity).toString(),
          requestType: input.requestType ?? 'buy',
          active: input.active ?? true,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        update: {
          level: new Decimal(input.level).toString(),
          quantity: new Decimal(input.quantity).toString(),
          requestType: input.requestType,
          active: input.active,
          updatedById: actor.userId,
        },
      });
      if (before) await this.audit.recordUpdate(tx, actor, 'reorder_level', after.id, { ...before, level: before.level.toString(), quantity: before.quantity.toString() }, { ...after, level: after.level.toString(), quantity: after.quantity.toString() });
      else await this.audit.record(tx, actor, { action: 'create', entityType: 'reorder_level', entityId: after.id, changes: { item: item.code, level: input.level, quantity: input.quantity } });
      return { ...after, level: after.level.toString(), quantity: after.quantity.toString() };
    });
  }

  // ---- Settings ----

  async getSettings() {
    const company = await this.company.current();
    const s = await this.prisma.inventorySettings.findUnique({ where: { companyId: company.id } });
    if (!s) throw new NotFoundException('Inventory settings missing');
    return { ...s, stockLockDate: iso(s.stockLockDate) };
  }

  /** Decision 36: the month-end lock. Moving it backwards (reopening) is logged like any other change. */
  async updateSettings(input: UpdateInventorySettingsInput, actor: Actor) {
    const company = await this.company.current();
    const before = await this.prisma.inventorySettings.findUniqueOrThrow({ where: { companyId: company.id } });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.inventorySettings.update({
        where: { companyId: company.id },
        data: {
          stockLockDate: input.stockLockDate === undefined ? undefined : input.stockLockDate ? new Date(`${input.stockLockDate}T00:00:00Z`) : null,
          allowNegativeAtTill: input.allowNegativeAtTill,
          batchPickOrder: input.batchPickOrder,
          updatedById: actor.userId,
        },
      });
      await this.audit.recordUpdate(tx, actor, 'inventory_settings', company.id, { ...before, stockLockDate: iso(before.stockLockDate) }, { ...after, stockLockDate: iso(after.stockLockDate) });
      return { ...after, stockLockDate: iso(after.stockLockDate) };
    });
  }
}
