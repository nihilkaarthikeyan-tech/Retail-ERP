// Copyright (c) 2026, Rademics. All rights reserved.
// Home deliveries of till bills (plan 11 B4; decisions 46 and 47): a list per
// store of pending, delivered and cancelled deliveries. A manager marks one
// delivered, which records who and when. No pick lists or delivery trips.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser, DeliveryQuery, DeliveryUpdateInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deliveryDto } from './pos-bills.service.js';
import { fromIso, iso, PosCommon } from './pos-common.service.js';

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
  ) {}

  async list(q: DeliveryQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    if (q.storeId) assertStoreAccess(user, q.storeId);
    const own = allowedStoreIds(user);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.PosDeliveryWhereInput = {
      companyId: company.id,
      ...(q.storeId ? { storeId: q.storeId } : own ? { storeId: { in: own } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lt: new Date(fromIso(q.to).getTime() + 86_400_000 - 330 * 60_000) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.posDelivery.findMany({ where, orderBy: [{ deliverOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.posDelivery.count({ where }),
    ]);
    const bills = await this.prisma.posBill.findMany({ where: { id: { in: rows.map((r) => r.billId) } }, select: { id: true, number: true, total: true, businessDate: true, customerId: true } });
    const stores = await this.prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, code: true, name: true } });
    const people = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.deliveredById).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
    const bill = new Map(bills.map((b) => [b.id, b]));
    const store = new Map(stores.map((s) => [s.id, s]));
    const person = new Map(people.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ')]));
    return {
      rows: rows.map((r) => ({
        ...deliveryDto(r),
        store: store.get(r.storeId) ?? null,
        bill: bill.has(r.billId) ? { id: r.billId, number: bill.get(r.billId)!.number, total: bill.get(r.billId)!.total.toFixed(2), businessDate: iso(bill.get(r.billId)!.businessDate) } : null,
        deliveredBy: r.deliveredById ? (person.get(r.deliveredById) ?? null) : null,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Marks a pending delivery delivered, with who and when (decision 46). */
  async markDelivered(id: string, input: DeliveryUpdateInput, actor: Actor, user: CurrentUser) {
    return this.change(id, 'delivered', input.remarks ?? null, actor, user);
  }

  async cancel(id: string, input: DeliveryUpdateInput, actor: Actor, user: CurrentUser) {
    if (!input.remarks?.trim()) throw new BadRequestException('Give the reason for cancelling the delivery');
    return this.change(id, 'cancelled', input.remarks, actor, user);
  }

  private async change(id: string, status: 'delivered' | 'cancelled', remarks: string | null, actor: Actor, user: CurrentUser) {
    const before = await this.prisma.posDelivery.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Delivery not found');
    assertStoreAccess(user, before.storeId);
    return this.prisma.$transaction(async (tx) => {
      // Only a pending delivery changes; two people at once cannot both mark it.
      const done = await tx.posDelivery.updateMany({
        where: { id, status: 'pending' },
        data: { status, ...(status === 'delivered' ? { deliveredAt: new Date(), deliveredById: user.id } : {}), ...(remarks ? { remarks } : {}), updatedById: actor.userId },
      });
      if (done.count !== 1) throw new BadRequestException(`This delivery is already ${before.status}`);
      const after = await tx.posDelivery.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'pos_delivery', entityId: id, changes: { status: { old: before.status, new: after.status } }, ...(remarks ? { reason: remarks } : {}) });
      return deliveryDto(after);
    });
  }
}
