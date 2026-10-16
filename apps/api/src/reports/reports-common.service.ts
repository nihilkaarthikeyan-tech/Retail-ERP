// Copyright (c) 2026, Rademics. All rights reserved.
// Shared helpers for reports and dashboards (plan 09): the company, the
// stores a user may see (blueprint 14: reports are quietly limited to them),
// default dates and lookups of names.
import { ForbiddenException, Injectable } from '@nestjs/common';
import { addDays, businessDate, type CurrentUser, Decimal, hasPermission, type PermissionKey } from 'shared';
import { canAccessStore } from '../auth/store-access.js';
import { CompanyService } from '../company/company.service.js';
import type { Company } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type Amount = { toString(): string } | null | undefined;
export const D = (v: Amount) => new Decimal(v ? v.toString() : '0');
export const ZERO = new Decimal(0);
export const money = (d: Decimal) => d.toFixed(2);
export const qty = (d: Decimal) => d.toDecimalPlaces(3).toString();
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);
export const pctText = (d: Decimal | null) => (d === null ? null : d.toFixed(2));

export interface StoreScope {
  /** null = every store of the company. */
  ids: string[] | null;
}

@Injectable()
export class ReportsCommon {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: CompanyService,
  ) {}

  current(): Promise<Company> {
    return this.company.current();
  }

  /** The stores a report covers: the one asked for (if allowed), else every store the user may see. */
  scope(user: CurrentUser, storeId?: string): StoreScope {
    if (storeId) {
      if (!canAccessStore(user, storeId)) throw new ForbiddenException('You are not allowed to see this store');
      return { ids: [storeId] };
    }
    return { ids: user.allStores || user.isOwnerAdmin ? null : user.stores.map((s) => s.id) };
  }

  require(user: CurrentUser, ...keys: PermissionKey[]) {
    if (!keys.some((k) => hasPermission(user, k))) throw new ForbiddenException('You are not allowed to see this report');
  }

  /** Cost and margin are hidden from those without the cost-price right (decision 70). */
  seesCost(user: CurrentUser): boolean {
    return hasPermission(user, 'cost_price.view') || hasPermission(user, 'stock.cost.view');
  }

  /** Default period: the given dates, else the last `days` days ending today (Indian date). */
  period(from: string | undefined, to: string | undefined, days = 1): { from: string; to: string } {
    const end = to ?? businessDate();
    return { from: from ?? addDays(end, -(days - 1)), to: end };
  }

  async stores(companyId: string) {
    return new Map((await this.prisma.store.findMany({ where: { companyId }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
  }

  async items(ids: string[]) {
    const rows = await this.prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, itemGroupId: true, brandId: true, baseUnit: { select: { code: true } } } });
    return new Map(rows.map((r) => [r.id, { id: r.id, code: r.code, name: r.name, itemGroupId: r.itemGroupId, brandId: r.brandId, unit: r.baseUnit.code }]));
  }

  async groups(ids: string[]) {
    return new Map((await this.prisma.itemGroup.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })).map((g) => [g.id, g]));
  }

  async brands(ids: string[]) {
    return new Map((await this.prisma.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((b) => [b.id, b]));
  }

  async users(ids: string[]) {
    return new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName}${u.lastName ? ` ${u.lastName}` : ''}`]));
  }

  async customers(ids: string[]) {
    return new Map((await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })).map((c) => [c.id, c]));
  }
}
