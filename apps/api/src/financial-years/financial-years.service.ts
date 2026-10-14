// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  businessDate,
  type CreateFinancialYearInput,
  daysUntil,
  INDIA_TIME_ZONE,
  endsAfterStart,
  financialYearName,
  isRegularYear,
  nextFinancialYear,
  rangesOverlap,
  type UpdateFinancialYearInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { FinancialYear } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SYSTEM_ACTOR: Actor = { userId: null, ipAddress: null };
/** The nightly job creates the next year this many days before the current one ends. */
const CREATE_NEXT_YEAR_DAYS_BEFORE_END = 3;

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

@Injectable()
export class FinancialYearsService {
  private readonly log = new Logger(FinancialYearsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  async list() {
    const company = await this.company.current();
    const years = await this.prisma.financialYear.findMany({
      where: { companyId: company.id },
      orderBy: { startDate: 'desc' },
    });
    return years.map(toDto);
  }

  async create(input: CreateFinancialYearInput, actor: Actor) {
    const company = await this.company.current();
    const created = await this.prisma.$transaction((tx) => this.createIn(tx, company.id, input, actor, false));
    return toDto(created);
  }

  /** Shared by the API, setup and the nightly job; runs inside the caller's transaction. */
  async createIn(
    db: Db,
    companyId: string,
    input: CreateFinancialYearInput,
    actor: Actor,
    createdAutomatically: boolean,
  ): Promise<FinancialYear> {
    const range = { startDate: input.startDate, endDate: input.endDate };
    if (!endsAfterStart(range)) throw new BadRequestException('The year must end after it starts');
    const regular = isRegularYear(range);
    if (!regular && !input.isIrregular) {
      throw new BadRequestException(
        'A regular year ends exactly one year minus one day after it starts. Mark it as a short or long year if that is intended.',
      );
    }
    const existing = await db.financialYear.findMany({ where: { companyId } });
    for (const year of existing) {
      const other = { startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate) };
      if (rangesOverlap(range, other)) {
        throw new BadRequestException(`Overlaps financial year ${year.name} (${other.startDate} to ${other.endDate})`);
      }
    }
    const name = financialYearName(range);
    if (existing.some((y) => y.name === name)) throw new BadRequestException(`A year named ${name} already exists`);

    const created = await db.financialYear.create({
      data: {
        companyId,
        name,
        startDate: fromIsoDate(range.startDate),
        endDate: fromIsoDate(range.endDate),
        isIrregular: !regular,
        createdAutomatically,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(db, actor, {
      action: 'create',
      entityType: 'financial_year',
      entityId: created.id,
      changes: { name, ...range, isIrregular: !regular, createdAutomatically },
    });
    return created;
  }

  /** Open or lock a year (decision 6: Accountant or Owner/Admin only, enforced by the route). */
  async update(id: string, input: UpdateFinancialYearInput, actor: Actor) {
    const before = await this.prisma.financialYear.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Financial year not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.financialYear.update({
        where: { id },
        data: { status: input.status, updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'financial_year', id, before, after);
      return after;
    });
    return toDto(updated);
  }

  /** The financial year an ISO date falls in, or null. */
  async forDate(db: Db, companyId: string, date: string): Promise<FinancialYear | null> {
    const d = fromIsoDate(date);
    return db.financialYear.findFirst({ where: { companyId, startDate: { lte: d }, endDate: { gte: d } } });
  }

  /** Runs at 02:00 Indian time; "today" is the Indian calendar date. */
  @Cron('0 2 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    try {
      const created = await this.createNextYearsIfDue(businessDate());
      if (created.length) this.log.log(`Created financial year(s): ${created.map((y) => y.name).join(', ')}`);
    } catch (err) {
      this.log.error('Nightly financial-year check failed', err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * For every company whose latest regular year ends within three days (or has
   * already ended), creates the following year (blueprint 02, process 3).
   */
  async createNextYearsIfDue(today: string): Promise<FinancialYear[]> {
    const created: FinancialYear[] = [];
    const companies = await this.prisma.company.findMany({ where: { active: true }, select: { id: true } });
    for (const company of companies) {
      const latest = await this.prisma.financialYear.findFirst({
        where: { companyId: company.id },
        orderBy: { endDate: 'desc' },
      });
      if (!latest || latest.isIrregular) continue; // after a short year, the next is created by hand
      if (daysUntil(today, toIsoDate(latest.endDate)) > CREATE_NEXT_YEAR_DAYS_BEFORE_END) continue;
      const next = nextFinancialYear({ startDate: toIsoDate(latest.startDate), endDate: toIsoDate(latest.endDate) });
      const year = await this.prisma.$transaction((tx) =>
        this.createIn(tx, company.id, { ...next, isIrregular: false }, SYSTEM_ACTOR, true),
      );
      created.push(year);
    }
    return created;
  }
}

function toDto(year: FinancialYear) {
  return {
    id: year.id,
    name: year.name,
    startDate: toIsoDate(year.startDate),
    endDate: toIsoDate(year.endDate),
    isIrregular: year.isIrregular,
    status: year.status,
    createdAutomatically: year.createdAutomatically,
    createdAt: year.createdAt,
  };
}
