// Copyright (c) 2026, Rademics. All rights reserved.
// Sales staff (plan 11 C1, decision 48 change of 16 October 2026): a simple
// list of salespeople per store, picked or scanned at the till. They need no
// login. No commissions, teams or targets.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser, SalesStaffInput, UpdateSalesStaffInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { SalesStaff } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PosCommon } from './pos-common.service.js';

@Injectable()
export class SalesStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
  ) {}

  /** The salespeople of the user's own stores (one store, or all of them). */
  async list(user: CurrentUser, storeId?: string, includeOff = true) {
    const company = await this.common.currentCompany();
    if (storeId) assertStoreAccess(user, storeId);
    const own = allowedStoreIds(user);
    const rows = await this.prisma.salesStaff.findMany({
      where: { companyId: company.id, ...(storeId ? { storeId } : own ? { storeId: { in: own } } : {}), ...(includeOff ? {} : { active: true }) },
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
    });
    return rows.map(staffDto);
  }

  async create(input: SalesStaffInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.currentCompany();
    assertStoreAccess(user, input.storeId);
    const store = await this.prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.companyId !== company.id) throw new NotFoundException('Store not found');
    await this.checkCode(input.storeId, input.code, null);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.salesStaff.create({ data: { companyId: company.id, storeId: input.storeId, code: input.code, name: input.name, active: input.active ?? true, createdById: actor.userId, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'sales_staff', entityId: row.id, changes: { store: store.code, code: row.code, name: row.name } });
      return staffDto(row);
    });
  }

  async update(id: string, input: UpdateSalesStaffInput, actor: Actor, user: CurrentUser) {
    const before = await this.prisma.salesStaff.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Salesperson not found');
    assertStoreAccess(user, before.storeId);
    if (input.code && input.code !== before.code) await this.checkCode(before.storeId, input.code, id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.salesStaff.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'sales_staff', id, staffDto(before), staffDto(after));
      return staffDto(after);
    });
  }

  /** The code is what the cashier types or scans, so it is unique in its store. */
  private async checkCode(storeId: string, code: string, exceptId: string | null) {
    const same = await this.prisma.salesStaff.findUnique({ where: { storeId_code: { storeId, code } } });
    if (same && same.id !== exceptId) throw new ConflictException(`Code ${code} is already used by ${same.name} in this store`);
  }
}

export function staffDto(s: SalesStaff) {
  return { id: s.id, storeId: s.storeId, code: s.code, name: s.name, active: s.active, updatedAt: s.updatedAt };
}
