// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformLeadDto, PlatformShopDto } from 'shared';
import { SystemPrisma } from '../prisma/prisma.service.js';
import type { PlatformAdminUser } from './platform-auth.service.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Plan 14: the Retail ERP admin screen. Sees the list of shops and how much each
 * uses the system, never a shop's bills, customers or items.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly system: SystemPrisma) {}

  async shops(): Promise<PlatformShopDto[]> {
    const rows = await this.system.$queryRaw<
      {
        id: string;
        code: string;
        legalName: string;
        tradeName: string | null;
        shopType: string | null;
        city: string | null;
        active: boolean;
        createdAt: Date;
        setupCompletedAt: Date | null;
        trialEndsAt: Date | null;
        ownerName: string | null;
        ownerEmail: string | null;
        users: number;
        bills: number;
        lastActiveAt: Date | null;
      }[]
    >`
      SELECT c.id, c.code, c."legalName", c."tradeName", c."shopType", c.city, c.active, c."createdAt", c."setupCompletedAt", c."trialEndsAt",
        o."firstName" || coalesce(' ' || o."lastName", '') AS "ownerName", o.email AS "ownerEmail",
        (SELECT count(*)::int FROM "User" u WHERE u."companyId" = c.id) AS users,
        (SELECT count(*)::int FROM "PosBill" b WHERE b."companyId" = c.id) AS bills,
        (SELECT max(s."lastActiveAt") FROM "Session" s WHERE s."companyId" = c.id) AS "lastActiveAt"
      FROM "Company" c
      LEFT JOIN LATERAL (SELECT "firstName", "lastName", email FROM "User" u WHERE u."companyId" = c.id ORDER BY u."createdAt" LIMIT 1) o ON true
      ORDER BY c."createdAt" DESC`;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.tradeName ?? r.legalName,
      shopType: r.shopType,
      city: r.city,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      setupCompletedAt: iso(r.setupCompletedAt),
      trialEndsAt: iso(r.trialEndsAt),
      owner: r.ownerEmail ? { name: r.ownerName ?? '', email: r.ownerEmail } : null,
      users: r.users,
      bills: r.bills,
      lastActiveAt: iso(r.lastActiveAt),
    }));
  }

  /** Switches a shop off (its people cannot log in) or on; the reason goes into that shop's own history. */
  async setShopActive(id: string, active: boolean, reason: string, admin: PlatformAdminUser, ipAddress: string | null): Promise<PlatformShopDto> {
    const before = await this.system.company.findUnique({ where: { id }, select: { active: true } });
    if (!before) throw new NotFoundException('Shop not found');
    await this.system.$transaction([
      this.system.company.update({ where: { id }, data: { active } }),
      this.system.auditLog.create({
        data: { companyId: id, userId: null, ipAddress, action: 'update', entityType: 'company', entityId: id, changes: { active: { old: before.active, new: active }, byRetailErpAdmin: admin.email }, reason },
      }),
    ]);
    return (await this.shops()).find((s) => s.id === id)!;
  }

  async leads(): Promise<PlatformLeadDto[]> {
    const rows = await this.system.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((l) => ({ id: l.id, name: l.name, phone: l.phone, email: l.email, shopName: l.shopName, shopType: l.shopType, message: l.message, createdAt: l.createdAt.toISOString(), handledAt: iso(l.handledAt) }));
  }

  async setLeadHandled(id: string, handled: boolean): Promise<PlatformLeadDto> {
    const lead = await this.system.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Message not found');
    await this.system.lead.update({ where: { id }, data: { handledAt: handled ? (lead.handledAt ?? new Date()) : null } });
    return (await this.leads()).find((l) => l.id === id)!;
  }
}
