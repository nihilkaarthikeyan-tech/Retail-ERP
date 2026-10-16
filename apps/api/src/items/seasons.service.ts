// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C4 (owner decision of 16 October 2026): seasons or collections.
// An item or style carries one season; reports and the markdown tool choose
// items by it.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSeasonInput, UpdateSeasonInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Season } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const date = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
const fromDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : iso === null ? null : undefined);

@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  async list() {
    const company = await this.company.current();
    const rows = await this.prisma.season.findMany({ where: { companyId: company.id }, orderBy: [{ active: 'desc' }, { startsOn: 'desc' }, { code: 'asc' }] });
    const counts = await this.prisma.item.groupBy({ by: ['seasonId'], where: { seasonId: { in: rows.map((r) => r.id) }, isParentStyle: false }, _count: { _all: true } });
    const countOf = new Map(counts.map((c) => [c.seasonId, c._count._all]));
    return rows.map((r) => ({ ...this.dto(r), itemCount: countOf.get(r.id) ?? 0 }));
  }

  async get(db: Db, id: string): Promise<Season> {
    const company = await this.company.current();
    const s = await db.season.findUnique({ where: { id } });
    if (!s || s.companyId !== company.id) throw new NotFoundException('Season not found');
    return s;
  }

  /** For items: the season must exist and be in use. */
  async assertUsable(db: Db, id: string): Promise<Season> {
    const s = await this.get(db, id);
    if (!s.active) throw new BadRequestException(`Season ${s.name} is switched off`);
    return s;
  }

  async create(input: CreateSeasonInput, actor: Actor) {
    const company = await this.company.current();
    if (await this.prisma.season.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) {
      throw new ConflictException(`Season ${input.code} already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.season.create({
        data: {
          companyId: company.id,
          code: input.code,
          name: input.name,
          startsOn: fromDate(input.startsOn) ?? null,
          endsOn: fromDate(input.endsOn) ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'season', entityId: created.id, changes: { code: created.code, name: created.name, startsOn: date(created.startsOn), endsOn: date(created.endsOn) } });
      return this.dto(created);
    });
  }

  async update(id: string, input: UpdateSeasonInput, actor: Actor) {
    const before = await this.get(this.prisma, id);
    const startsOn = input.startsOn === undefined ? date(before.startsOn) : input.startsOn;
    const endsOn = input.endsOn === undefined ? date(before.endsOn) : input.endsOn;
    if (startsOn && endsOn && endsOn < startsOn) throw new BadRequestException('The season cannot end before it starts');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.season.update({
        where: { id },
        data: { name: input.name, startsOn: fromDate(input.startsOn), endsOn: fromDate(input.endsOn), active: input.active, updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'season', id, this.dto(before), this.dto(after));
      return this.dto(after);
    });
  }

  private dto(s: Season) {
    return { id: s.id, code: s.code, name: s.name, startsOn: date(s.startsOn), endsOn: date(s.endsOn), active: s.active };
  }
}
