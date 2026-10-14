// Copyright (c) 2026, Rademics. All rights reserved.
import { Controller, Get, Query } from '@nestjs/common';
import { type AuditQuery, auditQuerySchema, endOfBusinessDay, startOfBusinessDay } from 'shared';
import { RequirePermission } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LOGIN_ACTIONS } from './audit.service.js';

const DEFAULT_LIMIT = 100;

@Controller('audit')
@RequirePermission('audit.view')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Change history, newest first. `before` is the id of the last row seen (cursor). */
  @Get()
  changes(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.query(q, { action: { notIn: LOGIN_ACTIONS } });
  }

  /** Logins, failures, lockouts and logouts. */
  @Get('logins')
  logins(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.query(q, { action: { in: LOGIN_ACTIONS } });
  }

  private async query(q: AuditQuery, extra: Prisma.AuditLogWhereInput) {
    const where: Prisma.AuditLogWhereInput = {
      ...extra,
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      // Date filters are Indian calendar days.
      ...(q.from || q.to
        ? {
            at: {
              ...(q.from ? { gte: startOfBusinessDay(q.from) } : {}),
              ...(q.to ? { lt: endOfBusinessDay(q.to) } : {}),
            },
          }
        : {}),
      ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
    };
    const limit = q.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const page = rows.slice(0, limit).map((r) => ({
      id: r.id.toString(),
      at: r.at,
      user: r.userId ? (byId.get(r.userId) ?? { id: r.userId }) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      changes: r.changes,
      reason: r.reason,
      ipAddress: r.ipAddress,
    }));
    return { rows: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
  }
}
