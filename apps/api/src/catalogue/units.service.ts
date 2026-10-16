// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  conversionFactor,
  type CreateUnitConversionInput,
  type CreateUnitInput,
  Decimal,
  fractionsAllowedForKind,
  quantityProblem,
  type UpdateUnitInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Unit } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Standard units every installation starts with (also in the module 2 migration). */
const STANDARD_UNITS: { code: string; name: string; kind: Unit['kind']; allowsFractions: boolean }[] = [
  { code: 'PCS', name: 'Piece', kind: 'count', allowsFractions: false },
  { code: 'BOX', name: 'Box', kind: 'count', allowsFractions: false },
  { code: 'PKT', name: 'Packet', kind: 'count', allowsFractions: false },
  { code: 'DOZ', name: 'Dozen', kind: 'count', allowsFractions: false },
  { code: 'KG', name: 'Kilogram', kind: 'weight', allowsFractions: true },
  { code: 'G', name: 'Gram', kind: 'weight', allowsFractions: true },
  { code: 'L', name: 'Litre', kind: 'volume', allowsFractions: true },
  { code: 'ML', name: 'Millilitre', kind: 'volume', allowsFractions: true },
  { code: 'M', name: 'Metre', kind: 'length', allowsFractions: true },
  { code: 'CM', name: 'Centimetre', kind: 'length', allowsFractions: true },
];
const STANDARD_CONVERSIONS: [string, string, string][] = [
  ['KG', 'G', '1000'],
  ['L', 'ML', '1000'],
  ['M', 'CM', '100'],
  ['DOZ', 'PCS', '12'],
];

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Idempotent; used on start-up and by the test database reset.
   * Safe when called at the same moment: rows that already exist are skipped, never an error.
   */
  async ensureStandardUnits(db: Db): Promise<void> {
    await db.unit.createMany({ data: STANDARD_UNITS, skipDuplicates: true });
    const units = await db.unit.findMany({ where: { code: { in: STANDARD_UNITS.map((u) => u.code) } } });
    const idOf = (code: string) => units.find((u) => u.code === code)!.id;
    await db.unitConversion.createMany({
      data: STANDARD_CONVERSIONS.map(([from, to, factor]) => ({ fromUnitId: idOf(from), toUnitId: idOf(to), factor: new Decimal(factor) })),
      skipDuplicates: true,
    });
  }

  list() {
    return this.prisma.unit.findMany({ orderBy: [{ kind: 'asc' }, { code: 'asc' }] });
  }

  async get(db: Db, id: string): Promise<Unit> {
    const unit = await db.unit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(input: CreateUnitInput, actor: Actor) {
    if (await this.prisma.unit.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`Unit ${input.code} already exists`);
    }
    const allowsFractions = input.allowsFractions ?? fractionsAllowedForKind(input.kind);
    if (allowsFractions && !fractionsAllowedForKind(input.kind)) {
      throw new BadRequestException('Fractions are only allowed for weight, length and volume units (decision 11)');
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.unit.create({
        data: { ...input, allowsFractions, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'unit', entityId: created.id, changes: { code: created.code, kind: created.kind } });
      return created;
    });
  }

  async update(id: string, input: UpdateUnitInput, actor: Actor) {
    const before = await this.get(this.prisma, id);
    if (input.allowsFractions && !fractionsAllowedForKind(before.kind)) {
      throw new BadRequestException('Fractions are only allowed for weight, length and volume units (decision 11)');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.unit.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'unit', id, before, after);
      return after;
    });
  }

  listConversions() {
    return this.prisma.unitConversion.findMany({ include: { fromUnit: true, toUnit: true }, orderBy: { createdAt: 'asc' } });
  }

  async createConversion(input: CreateUnitConversionInput, actor: Actor) {
    if (input.fromUnitId === input.toUnitId) throw new BadRequestException('The two units must differ');
    const from = await this.get(this.prisma, input.fromUnitId);
    const to = await this.get(this.prisma, input.toUnitId);
    if (from.kind !== to.kind) throw new BadRequestException('Conversions are only between units of the same kind');
    const existing = await this.prisma.unitConversion.findFirst({
      where: {
        OR: [
          { fromUnitId: from.id, toUnitId: to.id },
          { fromUnitId: to.id, toUnitId: from.id },
        ],
      },
    });
    if (existing) throw new ConflictException('A conversion between these units already exists');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.unitConversion.create({
        data: { fromUnitId: from.id, toUnitId: to.id, factor: new Decimal(input.factor), createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'unit_conversion',
        entityId: created.id,
        changes: { from: from.code, to: to.code, factor: input.factor },
      });
      return created;
    });
  }

  /** Known factor between two units, or null. */
  async factorBetween(db: Db, fromUnitId: string, toUnitId: string): Promise<Decimal | null> {
    const rows = await db.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } });
    return conversionFactor(fromUnitId, toUnitId, rows.map((r) => ({ ...r, factor: r.factor.toString() })));
  }

  /** Throws when a quantity breaks the unit's fraction rule (shared by every later module). */
  assertQuantityAllowed(unit: Pick<Unit, 'code' | 'allowsFractions'>, quantity: string): void {
    const problem = quantityProblem(quantity, unit);
    if (problem) throw new BadRequestException(problem);
  }
}
