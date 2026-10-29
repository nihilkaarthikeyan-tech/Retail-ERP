// Copyright (c) 2026, Rademics. All rights reserved.
// Alteration and tailoring jobs (plan 11 part 2 §2). A job slip lists the
// garments and the work on each, the tailor (a salesperson of the store or a
// typed name), the promised date and the charge. It moves received → with the
// tailor → ready → delivered (or cancelled), each step with who and when. The
// charge is billed at the till as a service line, either on the purchase bill
// or when the garment is collected, as the cashier chooses, and never twice
// (PosBillsService keeps chargeBillId). No stock moves.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ALTERATION_NEXT, type AlterationJobInput, type AlterationQuery, type AlterationStatus, type AlterationStatusInput, businessDate, type CurrentUser } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { D, fromIso, iso } from '../pos/pos-common.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from './orders.service.js';

const jobInclude = { lines: { orderBy: { lineNo: 'asc' } } } satisfies Prisma.AlterationJobInclude;
type JobRow = Prisma.AlterationJobGetPayload<{ include: typeof jobInclude }>;

/** One step of a job's history: the status it moved to, when and by whom. */
export interface StatusStep {
  status: AlterationStatus;
  at: string;
  byId: string | null;
  remarks?: string | null;
}

@Injectable()
export class AlterationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly orders: OrdersService,
  ) {}

  async list(q: AlterationQuery, user: CurrentUser) {
    const company = await this.orders.ready();
    if (q.storeId) assertStoreAccess(user, q.storeId);
    const own = allowedStoreIds(user);
    const today = fromIso(businessDate());
    const working = { in: ['received', 'with_tailor', 'ready'] };
    const view = q.view ?? 'open';
    const where: Prisma.AlterationJobWhereInput = {
      companyId: company.id,
      ...(q.storeId ? { storeId: q.storeId } : own ? { storeId: { in: own } } : {}),
      ...(view === 'open' ? { status: working } : {}),
      ...(view === 'due_today' ? { status: { in: ['received', 'with_tailor'] }, promisedOn: today } : {}),
      // Not handed back by the promised date (ready but not collected counts too).
      ...(view === 'overdue' ? { status: working, promisedOn: { lt: today } } : {}),
      ...(view === 'ready' || view === 'delivered' || view === 'cancelled' ? { status: view } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const [rows, total] = await Promise.all([
      this.prisma.alterationJob.findMany({ where, include: jobInclude, orderBy: view === 'delivered' || view === 'cancelled' || view === 'all' ? [{ createdAt: 'desc' }] : [{ promisedOn: 'asc' }, { number: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.alterationJob.count({ where }),
    ]);
    const names = await this.names(rows);
    return { rows: rows.map((j) => this.dto(j, names)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const j = await this.row(this.prisma, id);
    assertStoreAccess(user, j.storeId);
    return this.dto(j, await this.names([j]));
  }

  async create(input: AlterationJobInput, actor: Actor, user: CurrentUser) {
    const company = await this.orders.ready();
    assertStoreAccess(user, input.storeId);
    const data = await this.checkInput(company.id, input, null);
    const job = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: 'alteration', date: businessDate() });
      const history: StatusStep[] = [{ status: 'received', at: new Date().toISOString(), byId: actor.userId }];
      const j = await tx.alterationJob.create({
        data: { companyId: company.id, storeId: input.storeId, number, ...data.fields, statusHistory: history as unknown as Prisma.InputJsonValue, createdById: actor.userId, updatedById: actor.userId, lines: { create: data.lines } },
        include: jobInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'alteration_job', entityId: j.id, changes: { number, charge: j.charge.toFixed(2), chargePaidWith: j.chargePaidWith, promisedOn: input.promisedOn } });
      return j;
    });
    return this.dto(job, await this.names([job]));
  }

  /** Details change until the garment is handed back; the charge only until it is billed. */
  async update(id: string, input: AlterationJobInput, actor: Actor, user: CurrentUser) {
    const company = await this.orders.ready();
    const before = await this.row(this.prisma, id);
    assertStoreAccess(user, before.storeId);
    if (before.status === 'delivered' || before.status === 'cancelled') throw new BadRequestException(`Alteration ${before.number} is ${before.status}`);
    if (input.storeId !== before.storeId) throw new BadRequestException('A job stays with its store');
    const data = await this.checkInput(company.id, input, before);
    const after = await this.prisma.$transaction(async (tx) => {
      // Audit 7: checked again under a lock, so a hand-back or cancel at the same moment wins.
      await tx.$queryRaw`SELECT id FROM "AlterationJob" WHERE id = ${id}::uuid FOR UPDATE`;
      const now = await tx.alterationJob.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (now.status === 'delivered' || now.status === 'cancelled') throw new BadRequestException(`Alteration ${before.number} is ${now.status}`);
      await tx.alterationJobLine.deleteMany({ where: { jobId: id } });
      await tx.alterationJob.update({ where: { id }, data: { ...data.fields, updatedById: actor.userId, lines: { create: data.lines } } });
      const j = await this.row(tx, id);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'alteration_job', entityId: id, changes: { number: j.number, charge: { old: before.charge.toFixed(2), new: j.charge.toFixed(2) }, promisedOn: iso(j.promisedOn) } });
      return j;
    });
    return this.dto(after, await this.names([after]));
  }

  /** The next step, or cancelling; handing back needs the charge billed first. */
  async setStatus(id: string, input: AlterationStatusInput, actor: Actor, user: CurrentUser) {
    const j = await this.row(this.prisma, id);
    assertStoreAccess(user, j.storeId);
    const from = j.status as AlterationStatus;
    if (input.status === 'cancelled') {
      if (from === 'delivered' || from === 'cancelled') throw new BadRequestException(`Alteration ${j.number} is already ${from}`);
      if (j.chargeBillId) throw new BadRequestException(`The charge of alteration ${j.number} is billed; return it at the till before cancelling`);
      if (!input.remarks?.trim()) throw new BadRequestException('Give the reason for cancelling the job');
    } else if (ALTERATION_NEXT[from] !== input.status) {
      throw new BadRequestException(`Alteration ${j.number} is ${from.replace('_', ' ')}; it cannot move to ${input.status.replace('_', ' ')}`);
    }
    if (input.status === 'delivered' && D(j.charge).gt(0) && !j.chargeBillId) throw new BadRequestException(`Bill the ₹${D(j.charge).toFixed(2)} alteration charge at the till before handing the garment back`);
    const history: StatusStep[] = [...((j.statusHistory as unknown as StatusStep[] | null) ?? []), { status: input.status, at: new Date().toISOString(), byId: actor.userId, ...(input.remarks ? { remarks: input.remarks } : {}) }];
    const after = await this.prisma.$transaction(async (tx) => {
      // Two people at once: only one moves it.
      const done = await tx.alterationJob.updateMany({
        where: { id, status: from, ...(input.status === 'cancelled' ? { chargeBillId: null } : {}) },
        data: { status: input.status, statusHistory: history as unknown as Prisma.InputJsonValue, ...(input.status === 'delivered' ? { deliveredAt: new Date() } : {}), updatedById: actor.userId },
      });
      if (done.count !== 1) throw new BadRequestException(`Alteration ${j.number} changed a moment ago; open it again`);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'alteration_job', entityId: id, changes: { number: j.number, status: { old: from, new: input.status } }, ...(input.remarks ? { reason: input.remarks } : {}) });
      return this.row(tx, id);
    });
    return this.dto(after, await this.names([after]));
  }

  private async checkInput(companyId: string, input: AlterationJobInput, before: JobRow | null) {
    let name = input.name?.trim() || null;
    let phone = input.phone ?? null;
    if (input.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!c || c.companyId !== companyId) throw new BadRequestException('Customer not found');
      if (c.isWalkIn) {
        if (!name) throw new BadRequestException('For a walk-in customer, type the name and phone');
      } else {
        name = name ?? c.name;
        phone = phone ?? c.mobile;
      }
    }
    if (input.billId) {
      const b = await this.prisma.posBill.findUnique({ where: { id: input.billId }, include: { till: { select: { storeId: true } } } });
      if (!b || b.companyId !== companyId || b.kind !== 'sale') throw new BadRequestException('The bill was not found');
      if (b.till.storeId !== input.storeId) throw new BadRequestException(`Bill ${b.number} is from another store`);
    }
    if (input.tailorStaffId) {
      const s = await this.prisma.salesStaff.findUnique({ where: { id: input.tailorStaffId } });
      if (!s || s.companyId !== companyId || s.storeId !== input.storeId) throw new BadRequestException('Choose a tailor from this store’s staff, or type a name');
      if (!s.active && s.id !== before?.tailorStaffId) throw new BadRequestException(`${s.name} is switched off`);
    }
    if (!before && input.promisedOn < businessDate()) throw new BadRequestException('The promised date cannot be in the past');
    const charge = D(input.charge).toDecimalPlaces(2);
    if (before?.chargeBillId && !charge.eq(D(before.charge))) throw new BadRequestException(`The charge of alteration ${before.number} is billed; it cannot change`);
    if (before?.chargeBillId && input.chargePaidWith !== before.chargePaidWith) throw new BadRequestException(`The charge of alteration ${before.number} is billed already`);
    if (input.billId && before?.billId && input.billId !== before.billId && before.chargeBillId === before.billId) throw new BadRequestException('The charge was billed on the original bill; it stays');
    const itemIds = input.lines.map((l) => l.itemId).filter((x): x is string => !!x);
    if (itemIds.length) {
      const found = await this.prisma.item.count({ where: { id: { in: itemIds } } });
      if (found !== new Set(itemIds).size) throw new BadRequestException('Item not found');
    }
    return {
      fields: {
        customerId: input.customerId ?? null,
        name,
        phone,
        billId: input.billId ?? null,
        tailorStaffId: input.tailorStaffId ?? null,
        tailorName: input.tailorName?.trim() || null,
        promisedOn: fromIso(input.promisedOn),
        charge: charge.toFixed(2),
        chargePaidWith: input.chargePaidWith,
        remarks: input.remarks ?? null,
      },
      lines: input.lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId ?? null, garment: l.garment, work: l.work })),
    };
  }

  private async row(db: Db, id: string): Promise<JobRow> {
    const j = await db.alterationJob.findUnique({ where: { id }, include: jobInclude });
    if (!j) throw new NotFoundException('Alteration job not found');
    return j;
  }

  private async names(rows: JobRow[]) {
    const steps = rows.flatMap((r) => (r.statusHistory as unknown as StatusStep[] | null) ?? []);
    const [stores, staff, bills, people, items] = await Promise.all([
      this.prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.salesStaff.findMany({ where: { id: { in: rows.map((r) => r.tailorStaffId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }),
      this.prisma.posBill.findMany({ where: { id: { in: rows.flatMap((r) => [r.billId, r.chargeBillId]).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(steps.map((s) => s.byId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.item.findMany({ where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.itemId)).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }),
    ]);
    return {
      stores: new Map(stores.map((s) => [s.id, s])),
      staff: new Map(staff.map((s) => [s.id, s])),
      bills: new Map(bills.map((b) => [b.id, b.number])),
      people: new Map(people.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ')])),
      items: new Map(items.map((i) => [i.id, i])),
    };
  }

  dto(j: JobRow, names: Awaited<ReturnType<AlterationsService['names']>>) {
    const today = businessDate();
    const working = j.status === 'received' || j.status === 'with_tailor' || j.status === 'ready';
    const steps = (j.statusHistory as unknown as StatusStep[] | null) ?? [];
    const tailor = j.tailorStaffId ? names.staff.get(j.tailorStaffId) : null;
    return {
      id: j.id,
      number: j.number,
      status: j.status,
      store: names.stores.get(j.storeId) ?? null,
      storeId: j.storeId,
      customerId: j.customerId,
      name: j.name,
      phone: j.phone,
      bill: j.billId ? { id: j.billId, number: names.bills.get(j.billId) ?? null } : null,
      tailorStaffId: j.tailorStaffId,
      tailorName: j.tailorName,
      tailor: tailor ? tailor.name : j.tailorName,
      promisedOn: iso(j.promisedOn),
      dueToday: working && iso(j.promisedOn) === today,
      overdue: working && iso(j.promisedOn)! < today,
      charge: j.charge.toFixed(2),
      chargePaidWith: j.chargePaidWith,
      chargeBill: j.chargeBillId ? { id: j.chargeBillId, number: names.bills.get(j.chargeBillId) ?? null } : null,
      deliveredAt: j.deliveredAt,
      remarks: j.remarks,
      createdAt: j.createdAt,
      lines: j.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, item: l.itemId ? (names.items.get(l.itemId) ?? null) : null, garment: l.garment, work: l.work })),
      history: steps.map((s) => ({ status: s.status, at: s.at, byId: s.byId, by: s.byId ? (names.people.get(s.byId) ?? null) : null, remarks: s.remarks ?? null })),
    };
  }
}
