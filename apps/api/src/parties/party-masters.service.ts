// Copyright (c) 2026, Rademics. All rights reserved.
// Payment terms, customer groups and supplier groups.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateCustomerGroupInput,
  type CreatePaymentTermsInput,
  type CreateSupplierGroupInput,
  Decimal,
  dueDates,
  sharesProblem,
  type UpdateCustomerGroupInput,
  type UpdatePaymentTermsInput,
  type UpdateSupplierGroupInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { CustomerGroup, PaymentTerms, PaymentTermsPart, SupplierGroup } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GroupNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  active: boolean;
  isLeaf: boolean;
  priceListId: string | null;
  paymentTermsId: string | null;
  creditLimit?: string;
  overdueLimit?: string;
  skipCreditCheck?: boolean;
  children: GroupNode[];
}

type TermsRow = PaymentTerms & { parts: PaymentTermsPart[] };

@Injectable()
export class PartyMastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Payment terms ----

  async listTerms() {
    const rows = await this.prisma.paymentTerms.findMany({ include: { parts: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
    return rows.map(toTermsDto);
  }

  async getTerms(db: Db, id: string): Promise<TermsRow> {
    const terms = await db.paymentTerms.findUnique({ where: { id }, include: { parts: { orderBy: { sortOrder: 'asc' } } } });
    if (!terms) throw new NotFoundException('Payment terms not found');
    return terms;
  }

  /** Due dates for a bill date under these terms (used by sales/purchasing later). */
  async dueDatesFor(db: Db, paymentTermsId: string | null, billDate: string) {
    if (!paymentTermsId) return dueDates(billDate, []);
    const terms = await this.getTerms(db, paymentTermsId);
    return dueDates(
      billDate,
      terms.parts.map((p) => ({ share: p.share.toString(), dueBasis: p.dueBasis, days: p.days, months: p.months })),
    );
  }

  async createTerms(input: CreatePaymentTermsInput, actor: Actor) {
    if (await this.prisma.paymentTerms.findFirst({ where: { code: input.code } })) throw new ConflictException(`Payment terms ${input.code} already exist`);
    const problem = sharesProblem(input.parts);
    if (problem) throw new BadRequestException(problem);
    const created = await this.prisma.$transaction(async (tx) => {
      const terms = await tx.paymentTerms.create({
        data: { code: input.code, name: input.name, parts: { create: partsData(input.parts) }, createdById: actor.userId, updatedById: actor.userId },
        include: { parts: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'payment_terms', entityId: terms.id, changes: { code: terms.code, parts: describeParts(terms.parts) } });
      return terms;
    });
    return toTermsDto(created);
  }

  async updateTerms(id: string, input: UpdatePaymentTermsInput, actor: Actor) {
    const before = await this.getTerms(this.prisma, id);
    if (input.parts) {
      const problem = sharesProblem(input.parts);
      if (problem) throw new BadRequestException(problem);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.paymentTerms.update({
        where: { id },
        data: {
          name: input.name,
          active: input.active,
          updatedById: actor.userId,
          ...(input.parts ? { parts: { deleteMany: {}, create: partsData(input.parts) } } : {}),
        },
        include: { parts: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.audit.recordUpdate(tx, actor, 'payment_terms', id, { name: before.name, active: before.active, parts: describeParts(before.parts) }, { name: after.name, active: after.active, parts: describeParts(after.parts) });
      return after;
    });
    return toTermsDto(updated);
  }

  // ---- Customer groups ----

  async customerGroupTree(): Promise<GroupNode[]> {
    const rows = await this.prisma.customerGroup.findMany({ orderBy: [{ depth: 'asc' }, { name: 'asc' }] });
    return buildTree(rows.map((r) => ({ ...r, creditLimit: r.creditLimit.toString(), overdueLimit: r.overdueLimit.toString() })));
  }

  async assertLeafCustomerGroup(db: Db, id: string): Promise<CustomerGroup> {
    const group = await db.customerGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Customer group not found');
    if (!group.active) throw new BadRequestException(`Customer group ${group.name} is switched off`);
    if ((await db.customerGroup.count({ where: { parentId: id } })) > 0) throw new BadRequestException(`${group.name} has sub-groups; choose one of them`);
    return group;
  }

  /** Audit 7: a group's price list and terms must be this shop's own (the database links ignore the shop). */
  private async checkGroupRefs(input: { priceListId?: string | null; paymentTermsId?: string | null }, use: 'selling' | 'buying') {
    if (input.priceListId) {
      const list = await this.prisma.priceList.findUnique({ where: { id: input.priceListId } });
      if (!list?.active || !(use === 'selling' ? list.forSelling : list.forBuying)) throw new BadRequestException(`Price list must be an active ${use} list`);
    }
    if (input.paymentTermsId && !(await this.prisma.paymentTerms.findFirst({ where: { id: input.paymentTermsId, active: true } }))) {
      throw new BadRequestException('Payment terms not found or switched off');
    }
  }

  async createCustomerGroup(input: CreateCustomerGroupInput, actor: Actor) {
    await this.checkGroupRefs(input, 'selling');
    if (await this.prisma.customerGroup.findFirst({ where: { code: input.code } })) throw new ConflictException(`Group ${input.code} already exists`);
    const parent = input.parentId ? await this.prisma.customerGroup.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) throw new NotFoundException('Parent group not found');
    if (parent && (await this.prisma.customer.count({ where: { customerGroupId: parent.id } })) > 0) {
      throw new BadRequestException(`${parent.name} already has customers; it cannot become a folder`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.customerGroup.create({
        data: {
          code: input.code,
          name: input.name,
          parentId: parent?.id ?? null,
          path: '',
          depth: parent ? parent.depth + 1 : 0,
          priceListId: input.priceListId ?? null,
          paymentTermsId: input.paymentTermsId ?? null,
          creditLimit: new Decimal(input.creditLimit ?? '0'),
          overdueLimit: new Decimal(input.overdueLimit ?? '0'),
          skipCreditCheck: input.skipCreditCheck ?? false,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      const withPath = await tx.customerGroup.update({ where: { id: created.id }, data: { path: `${parent?.path ?? '/'}${created.id}/` } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'customer_group', entityId: created.id, changes: { code: created.code, name: created.name, parent: parent?.code ?? null } });
      return withPath;
    });
  }

  async updateCustomerGroup(id: string, input: UpdateCustomerGroupInput, actor: Actor) {
    const before = await this.prisma.customerGroup.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Customer group not found');
    await this.checkGroupRefs(input, 'selling');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.customerGroup.update({
        where: { id },
        data: {
          ...input,
          creditLimit: input.creditLimit === undefined ? undefined : new Decimal(input.creditLimit),
          overdueLimit: input.overdueLimit === undefined ? undefined : new Decimal(input.overdueLimit),
          updatedById: actor.userId,
        },
      });
      await this.audit.recordUpdate(tx, actor, 'customer_group', id, { ...before, creditLimit: before.creditLimit.toString(), overdueLimit: before.overdueLimit.toString() }, { ...after, creditLimit: after.creditLimit.toString(), overdueLimit: after.overdueLimit.toString() });
      return after;
    });
  }

  // ---- Supplier groups ----

  async supplierGroupTree(): Promise<GroupNode[]> {
    const rows = await this.prisma.supplierGroup.findMany({ orderBy: [{ depth: 'asc' }, { name: 'asc' }] });
    return buildTree(rows);
  }

  async assertLeafSupplierGroup(db: Db, id: string): Promise<SupplierGroup> {
    const group = await db.supplierGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Supplier group not found');
    if (!group.active) throw new BadRequestException(`Supplier group ${group.name} is switched off`);
    if ((await db.supplierGroup.count({ where: { parentId: id } })) > 0) throw new BadRequestException(`${group.name} has sub-groups; choose one of them`);
    return group;
  }

  async createSupplierGroup(input: CreateSupplierGroupInput, actor: Actor) {
    await this.checkGroupRefs(input, 'buying');
    if (await this.prisma.supplierGroup.findFirst({ where: { code: input.code } })) throw new ConflictException(`Group ${input.code} already exists`);
    const parent = input.parentId ? await this.prisma.supplierGroup.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) throw new NotFoundException('Parent group not found');
    if (parent && (await this.prisma.supplier.count({ where: { supplierGroupId: parent.id } })) > 0) {
      throw new BadRequestException(`${parent.name} already has suppliers; it cannot become a folder`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierGroup.create({
        data: {
          code: input.code,
          name: input.name,
          parentId: parent?.id ?? null,
          path: '',
          depth: parent ? parent.depth + 1 : 0,
          priceListId: input.priceListId ?? null,
          paymentTermsId: input.paymentTermsId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      const withPath = await tx.supplierGroup.update({ where: { id: created.id }, data: { path: `${parent?.path ?? '/'}${created.id}/` } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'supplier_group', entityId: created.id, changes: { code: created.code, name: created.name, parent: parent?.code ?? null } });
      return withPath;
    });
  }

  async updateSupplierGroup(id: string, input: UpdateSupplierGroupInput, actor: Actor) {
    const before = await this.prisma.supplierGroup.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Supplier group not found');
    await this.checkGroupRefs(input, 'buying');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.supplierGroup.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'supplier_group', id, before, after);
      return after;
    });
  }
}

function partsData(parts: CreatePaymentTermsInput['parts']) {
  return parts.map((p, i) => ({
    sortOrder: i,
    share: new Decimal(p.share),
    dueBasis: p.dueBasis,
    days: p.days ?? 0,
    months: p.months ?? 0,
    earlyDiscountPercent: p.earlyDiscountPercent != null ? new Decimal(p.earlyDiscountPercent) : null,
    earlyDiscountDays: p.earlyDiscountDays ?? null,
  }));
}

function describeParts(parts: PaymentTermsPart[]): string[] {
  return parts.map((p) => `${p.share.toString()}% ${p.dueBasis} ${p.dueBasis === 'months_then_month_end' ? p.months + 'm' : p.days + 'd'}`);
}

export function toTermsDto(t: TermsRow) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    active: t.active,
    parts: t.parts.map((p) => ({
      share: p.share.toString(),
      dueBasis: p.dueBasis,
      days: p.days,
      months: p.months,
      earlyDiscountPercent: p.earlyDiscountPercent?.toString() ?? null,
      earlyDiscountDays: p.earlyDiscountDays,
    })),
  };
}

function buildTree(
  rows: { id: string; code: string; name: string; parentId: string | null; active: boolean; priceListId: string | null; paymentTermsId: string | null; creditLimit?: string; overdueLimit?: string; skipCreditCheck?: boolean }[],
): GroupNode[] {
  const nodes = new Map<string, GroupNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      parentId: r.parentId,
      active: r.active,
      isLeaf: true,
      priceListId: r.priceListId,
      paymentTermsId: r.paymentTermsId,
      ...(r.creditLimit !== undefined ? { creditLimit: r.creditLimit, overdueLimit: r.overdueLimit, skipCreditCheck: r.skipCreditCheck } : {}),
      children: [],
    });
  }
  const roots: GroupNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
      parent.isLeaf = false;
    } else roots.push(node);
  }
  return roots;
}
