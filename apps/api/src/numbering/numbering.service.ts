// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type ChangeCounterInput,
  type CreateNumberSeriesInput,
  type CurrentUser,
  fillPattern,
  formatNumber,
  patternUsesStore,
  type UpdateNumberSeriesInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { NumberSeries } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AllocateRequest {
  companyId: string;
  documentKind: string;
  /** Required when the chosen series pattern uses {STORE}. */
  storeId?: string | null;
  /** ISO date the number is for; defaults to today's Indian business date. */
  date?: string;
}

@Injectable()
export class NumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly years: FinancialYearsService,
  ) {}

  // ---- Allocation (used by every document module) ----

  /**
   * Gives the next number for a document. Must be called inside the caller's
   * transaction so the number is only consumed if the document is saved. The
   * counter row is locked with SELECT ... FOR UPDATE, so two users never get
   * the same number (blueprint 02, calculations).
   */
  async allocate(tx: Db, req: AllocateRequest): Promise<string> {
    const series = await this.seriesFor(tx, req.companyId, req.documentKind, req.storeId ?? null);
    const filledPrefix = await this.filledPrefix(tx, series, req.storeId ?? null, req.date ?? businessDate());

    await tx.$executeRaw`
      INSERT INTO "NumberSeriesCounter" ("id", "numberSeriesId", "filledPrefix", "nextNumber", "updatedAt")
      VALUES (gen_random_uuid(), ${series.id}::uuid, ${filledPrefix}, 1, now())
      ON CONFLICT ("numberSeriesId", "filledPrefix") DO NOTHING`;
    const rows = await tx.$queryRaw<{ id: string; nextNumber: number }[]>`
      SELECT "id", "nextNumber" FROM "NumberSeriesCounter"
      WHERE "numberSeriesId" = ${series.id}::uuid AND "filledPrefix" = ${filledPrefix}
      FOR UPDATE`;
    const counter = rows[0];
    await tx.numberSeriesCounter.update({ where: { id: counter.id }, data: { nextNumber: counter.nextNumber + 1 } });
    return formatNumber(filledPrefix, counter.nextNumber, series.counterLength);
  }

  private async seriesFor(db: Db, companyId: string, documentKind: string, storeId: string | null) {
    const series =
      (storeId && (await db.numberSeries.findFirst({ where: { companyId, documentKind, storeId, active: true } }))) ||
      (await db.numberSeries.findFirst({ where: { companyId, documentKind, storeId: null, active: true } }));
    if (!series) throw new BadRequestException(`No active number series for ${documentKind}`);
    return series;
  }

  private async filledPrefix(db: Db, series: NumberSeries, storeId: string | null, date: string): Promise<string> {
    const company = await db.company.findUniqueOrThrow({ where: { id: series.companyId } });
    let storeCode: string | undefined;
    if (patternUsesStore(series.pattern)) {
      if (!storeId) throw new BadRequestException('This number series needs a store');
      const store = await db.store.findUnique({ where: { id: storeId } });
      if (!store) throw new BadRequestException('Store not found');
      storeCode = store.code;
    }
    let financialYearName = '';
    if (series.pattern.includes('{FY}') || series.pattern.includes('{FYS}')) {
      const year = await this.years.forDate(db, series.companyId, date);
      if (!year) throw new BadRequestException(`No financial year covers ${date}`);
      financialYearName = year.name;
    }
    return fillPattern(series.pattern, { date, financialYearName, storeCode, companyCode: company.code });
  }

  // ---- Administration ----

  async list() {
    const company = await this.company.current();
    return this.prisma.numberSeries.findMany({
      where: { companyId: company.id },
      orderBy: [{ documentKind: 'asc' }, { storeId: 'asc' }],
      include: { store: { select: { id: true, code: true, name: true } }, counters: { orderBy: { filledPrefix: 'asc' } } },
    });
  }

  async create(input: CreateNumberSeriesInput, actor: Actor) {
    const company = await this.company.current();
    const storeId = input.storeId ?? null;
    if (storeId && !(await this.prisma.store.findFirst({ where: { id: storeId, companyId: company.id } }))) {
      throw new BadRequestException('Store not found');
    }
    const duplicate = await this.prisma.numberSeries.findFirst({
      where: { companyId: company.id, documentKind: input.documentKind, storeId },
    });
    if (duplicate) throw new ConflictException('A series for this document kind and store already exists');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.numberSeries.create({
        data: {
          companyId: company.id,
          documentKind: input.documentKind,
          pattern: input.pattern,
          counterLength: input.counterLength ?? 5,
          storeId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'number_series',
        entityId: created.id,
        changes: { documentKind: created.documentKind, pattern: created.pattern, storeId },
      });
      return created;
    });
  }

  async update(id: string, input: UpdateNumberSeriesInput, actor: Actor) {
    const before = await this.prisma.numberSeries.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Number series not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.numberSeries.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'number_series', id, before, after);
      return after;
    });
  }

  /** What the next number would be, per store the user may see, without consuming it. */
  async preview(id: string, user: CurrentUser, date = businessDate()) {
    const series = await this.prisma.numberSeries.findUnique({ where: { id } });
    if (!series) throw new NotFoundException('Number series not found');
    const usesStore = patternUsesStore(series.pattern);
    const ids = allowedStoreIds(user);
    const stores = usesStore
      ? await this.prisma.store.findMany({
          where: {
            companyId: series.companyId,
            active: true,
            ...(series.storeId ? { id: series.storeId } : {}),
            ...(ids ? { id: { in: ids } } : {}),
          },
          orderBy: { code: 'asc' },
        })
      : [null];
    const result = [];
    for (const store of stores) {
      const filledPrefix = await this.filledPrefix(this.prisma, series, store?.id ?? null, date);
      const counter = await this.prisma.numberSeriesCounter.findUnique({
        where: { numberSeriesId_filledPrefix: { numberSeriesId: id, filledPrefix } },
      });
      const nextNumber = counter?.nextNumber ?? 1;
      result.push({
        store: store ? { id: store.id, code: store.code } : null,
        filledPrefix,
        nextNumber,
        next: formatNumber(filledPrefix, nextNumber, series.counterLength),
      });
    }
    return result;
  }

  /** Owner/Admin only (route-enforced). Logged with old and new value and the reason. */
  async changeCounter(id: string, input: ChangeCounterInput, actor: Actor) {
    const series = await this.prisma.numberSeries.findUnique({ where: { id } });
    if (!series) throw new NotFoundException('Number series not found');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.numberSeriesCounter.findUnique({
        where: { numberSeriesId_filledPrefix: { numberSeriesId: id, filledPrefix: input.filledPrefix } },
      });
      const counter = existing
        ? await tx.numberSeriesCounter.update({ where: { id: existing.id }, data: { nextNumber: input.nextNumber } })
        : await tx.numberSeriesCounter.create({
            data: { numberSeriesId: id, filledPrefix: input.filledPrefix, nextNumber: input.nextNumber },
          });
      await this.audit.record(tx, actor, {
        action: 'counter_change',
        entityType: 'number_series',
        entityId: id,
        changes: { filledPrefix: input.filledPrefix, nextNumber: { old: existing?.nextNumber ?? 1, new: input.nextNumber } },
        reason: input.reason,
      });
      return counter;
    });
  }
}
