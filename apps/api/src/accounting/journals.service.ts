// Copyright (c) 2026, Rademics. All rights reserved.
// Journals (blueprint 11 process 3): petty cash, rent and salaries, drawings,
// corrections, write-offs, notes without goods and opening balances. Drafts can
// be changed; a posted journal is only ever cancelled (decision 50).
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type CurrentUser, type DocListQuery, Decimal, hasPermission, type JournalInput, type JournalLineInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

const journalInclude = { lines: { orderBy: { lineNo: 'asc' as const } } } satisfies Prisma.JournalInclude;
type JournalRow = Prisma.JournalGetPayload<{ include: typeof journalInclude }>;

@Injectable()
export class JournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
  ) {}

  async list(q: DocListQuery, user: CurrentUser) {
    const company = await this.common.ready();
    // Audit 1 (28 October 2026): a person working in some stores sees only journals that touch no other store.
    const allowed = this.common.storeFilter(user);
    const rows = await this.prisma.journal.findMany({
      where: {
        companyId: company.id,
        ...(allowed ? { lines: { none: { storeId: { notIn: allowed } } } } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { remark: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }] } : {}),
        ...(q.from || q.to ? { journalDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
      },
      include: journalInclude,
      orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((j) => this.dto(j));
  }

  async get(id: string, user?: CurrentUser) {
    const j = await this.row(this.prisma, id);
    if (user) this.assertStores(user, j);
    return this.dto(j);
  }

  /** Audit 1: every store a journal touches must be one the person works in. */
  private assertStores(user: CurrentUser, j: { lines: { storeId: string | null }[] }) {
    for (const l of j.lines) this.common.assertStore(user, l.storeId);
  }

  async create(input: JournalInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    this.checkRights(input, user);
    await this.validate(this.prisma, company.id, input, user);
    const fy = await this.common.yearFor(this.prisma, company.id, input.journalDate);
    const created = await this.prisma.$transaction(async (tx) => {
      const j = await tx.journal.create({
        data: {
          companyId: company.id,
          kind: input.kind,
          journalDate: fromIso(input.journalDate),
          financialYearId: fy.id,
          reference: input.reference ?? null,
          referenceDate: input.referenceDate ? fromIso(input.referenceDate) : null,
          remark: input.remark ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: { create: this.lineData(input.lines) },
        },
        include: journalInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'journal', entityId: j.id, changes: { kind: j.kind, date: input.journalDate, lines: input.lines.length } });
      return j;
    });
    return this.dto(created);
  }

  async update(id: string, input: JournalInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    const before = await this.row(this.prisma, id);
    this.assertStores(user, before);
    if (before.status !== 'draft') throw new BadRequestException(`A ${before.status} journal cannot be changed; cancel it and make a new one`);
    this.checkRights(input, user);
    await this.validate(this.prisma, company.id, input, user);
    const fy = await this.common.yearFor(this.prisma, company.id, input.journalDate);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalId: id } });
      const j = await tx.journal.update({
        where: { id },
        data: {
          kind: input.kind,
          journalDate: fromIso(input.journalDate),
          financialYearId: fy.id,
          reference: input.reference ?? null,
          referenceDate: input.referenceDate ? fromIso(input.referenceDate) : null,
          remark: input.remark ?? null,
          updatedById: actor.userId,
          lines: { create: this.lineData(input.lines) },
        },
        include: journalInclude,
      });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'journal', entityId: id, changes: { date: input.journalDate, lines: input.lines.length } });
      return j;
    });
    return this.dto(after);
  }

  /** Posting writes the ledger entry and links lines to the bills they settle, in one transaction. */
  async post(id: string, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    const j = await this.row(this.prisma, id);
    if (j.status !== 'draft') throw new BadRequestException(`The journal is already ${j.status}`);
    const input = this.inputOf(j);
    this.checkRights(input, user);
    await this.validate(this.prisma, company.id, input, user);
    const posted = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.journal.findUniqueOrThrow({ where: { id } });
        if (fresh.status !== 'draft') throw new BadRequestException(`The journal is already ${fresh.status}`);
        const number = await this.common.allocate(tx, company.id, 'journal', iso(j.journalDate)!);
        // Re-check what is owed inside the transaction, with the bills locked.
        await this.checkAgainst(tx, company.id, input.lines);
        const entry = await this.ledger.post(tx, {
          companyId: company.id,
          date: iso(j.journalDate)!,
          documentType: 'journal',
          documentId: j.id,
          documentNumber: number,
          isOpening: j.kind === 'opening',
          tolerance: 'journal',
          actorId: actor.userId,
          remark: j.remark,
          lines: j.lines.map((l) => ({
            accountId: l.accountId,
            storeId: l.storeId,
            partyType: l.partyType as 'customer' | 'supplier' | null,
            partyId: l.partyId,
            debit: l.debit,
            credit: l.credit,
            ...(l.partyId ? { itemType: 'journal', itemId: j.id, itemNumber: number } : {}),
            remark: l.remark,
          })),
        });
        for (const l of j.lines) {
          if (!l.againstId || !l.againstType || !l.partyId) continue;
          const amount = D(l.debit).add(D(l.credit));
          await this.ledger.link(tx, { companyId: company.id, partyType: l.partyType!, partyId: l.partyId, billType: l.againstType, billId: l.againstId, byType: 'journal', byId: j.id, amount, date: iso(j.journalDate)!, actorId: actor.userId });
        }
        await tx.journal.update({ where: { id }, data: { status: 'posted', number, ledgerEntryId: entry?.id ?? null, postedAt: new Date(), postedById: actor.userId, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'journal', entityId: id, changes: { status: { old: 'draft', new: 'posted' }, number } });
        return this.row(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.dto(posted);
  }

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    await this.common.ready();
    const j = await this.row(this.prisma, id);
    if (j.status === 'cancelled') throw new BadRequestException('Already cancelled');
    this.checkRights(this.inputOf(j), user);
    this.assertStores(user, j);
    const after = await this.prisma.$transaction(async (tx) => {
      if (j.status === 'posted') {
        await this.ledger.undoLinks(tx, 'journal', id, actor.userId);
        await this.ledger.reverseDocument(tx, 'journal', id, actor.userId, `Cancelled: ${reason}`);
      }
      await tx.journal.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'journal', entityId: id, changes: { status: { old: j.status, new: 'cancelled' }, number: j.number }, reason });
      return this.row(tx, id);
    });
    return this.dto(after);
  }

  // ---- Checks ----

  /** Store managers may only make cash journals for their own stores (plan 07 §8: cash.deposit). */
  private checkRights(input: JournalInput, user: CurrentUser) {
    if (hasPermission(user, 'journals.post')) return;
    if (!hasPermission(user, 'cash.deposit')) throw new ForbiddenException('You are not allowed to make journals');
    if (input.kind !== 'cash') throw new ForbiddenException('Store managers can only make cash journals (petty cash)');
    if (input.lines.some((l) => l.partyId)) throw new ForbiddenException('Store managers cannot post to customer or supplier balances');
  }

  private async validate(db: Db, companyId: string, input: JournalInput, user: CurrentUser) {
    let dr = new Decimal(0);
    let cr = new Decimal(0);
    const accounts = await db.account.findMany({ where: { companyId, id: { in: [...new Set(input.lines.map((l) => l.accountId))] } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const [i, l] of input.lines.entries()) {
      const n = i + 1;
      const a = byId.get(l.accountId);
      if (!a) throw new BadRequestException(`Line ${n}: account not found`);
      if (a.isGroup) throw new BadRequestException(`Line ${n}: ${a.name} is a folder; choose an account under it`);
      if (!a.active) throw new BadRequestException(`Line ${n}: ${a.name} is switched off`);
      const party = a.kind === 'receivable' ? 'customer' : a.kind === 'payable' ? 'supplier' : null;
      if (party && (l.partyType !== party || !l.partyId)) throw new BadRequestException(`Line ${n}: ${a.name} needs the ${party}`);
      if (!party && l.partyId) throw new BadRequestException(`Line ${n}: only customer and supplier balance accounts take a party`);
      if ((a.family === 'income' || a.family === 'expense') && !l.storeId) throw new BadRequestException(`Line ${n}: ${a.name} needs a store (profit is tracked by shop)`);
      this.common.assertStore(user, l.storeId);
      if (a.storeId) this.common.assertStore(user, a.storeId);
      if (l.partyId) {
        const exists = l.partyType === 'customer' ? await db.customer.findFirst({ where: { id: l.partyId, companyId } }) : await db.supplier.findFirst({ where: { id: l.partyId, companyId } });
        if (!exists) throw new BadRequestException(`Line ${n}: ${l.partyType} not found`);
      }
      dr = dr.add(D(l.debit ?? 0));
      cr = cr.add(D(l.credit ?? 0));
    }
    if (!dr.eq(cr)) throw new BadRequestException(`Debits ₹${dr.toFixed(2)} and credits ₹${cr.toFixed(2)} must be equal (difference ₹${dr.sub(cr).abs().toFixed(2)})`);
    if (input.kind === 'opening') {
      if (!accounts.some((a) => a.kind === 'temporary_opening')) throw new BadRequestException('An opening journal must use the temporary opening account on the other side');
      if (await db.yearEndClosing.count({ where: { companyId, status: 'posted' } })) throw new BadRequestException('Opening entries are refused once a year has been closed');
    }
    await this.checkAgainst(db, companyId, input.lines);
  }

  /** A line against a bill: same party, the right side, not more than it owes (blueprint 11 process 3). */
  private async checkAgainst(db: Db, companyId: string, lines: Pick<JournalLineInput, 'againstType' | 'againstId' | 'partyType' | 'partyId' | 'debit' | 'credit'>[]) {
    const totals = new Map<string, Decimal>();
    for (const l of lines) {
      if (!l.againstId) continue;
      if (!l.againstType || !l.partyId || !l.partyType) throw new BadRequestException('A line against a bill must name the party');
      const items = await this.ledger.openItems(db, l.partyType, l.partyId);
      const bill = items.find((i) => i.itemType === l.againstType && i.itemId === l.againstId);
      if (!bill) throw new BadRequestException('That bill is not an open bill of this party');
      if (bill.owed.lte(0)) throw new BadRequestException(`Bill ${bill.number ?? ''} has nothing left to settle`);
      // Customer bills are settled by credits, supplier bills by debits.
      const settles = l.partyType === 'customer' ? D(l.credit ?? 0) : D(l.debit ?? 0);
      if (settles.lte(0)) throw new BadRequestException(`A line against a ${l.partyType} bill must be a ${l.partyType === 'customer' ? 'credit' : 'debit'}`);
      const k = `${l.againstType}|${l.againstId}`;
      const total = (totals.get(k) ?? new Decimal(0)).add(settles);
      if (total.gt(bill.owed)) throw new BadRequestException(`Bill ${bill.number ?? ''} owes only ₹${bill.owed.toFixed(2)}`);
      totals.set(k, total);
    }
    void companyId;
  }

  // ---- Mapping ----

  private lineData(lines: JournalLineInput[]) {
    return lines.map((l, i) => ({
      lineNo: i + 1,
      accountId: l.accountId,
      storeId: l.storeId ?? null,
      partyType: l.partyType ?? null,
      partyId: l.partyId ?? null,
      debit: D(l.debit ?? 0).toFixed(2),
      credit: D(l.credit ?? 0).toFixed(2),
      againstType: l.againstType ?? null,
      againstId: l.againstId ?? null,
      remark: l.remark ?? null,
    }));
  }

  private inputOf(j: JournalRow): JournalInput {
    return {
      kind: j.kind as JournalInput['kind'],
      journalDate: iso(j.journalDate)!,
      reference: j.reference,
      referenceDate: iso(j.referenceDate),
      remark: j.remark,
      lines: j.lines.map((l) => ({
        accountId: l.accountId,
        storeId: l.storeId,
        partyType: l.partyType as 'customer' | 'supplier' | null,
        partyId: l.partyId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        againstType: l.againstType,
        againstId: l.againstId,
        remark: l.remark,
      })),
    };
  }

  private async row(db: Db, id: string): Promise<JournalRow> {
    const company = await this.common.ready(db);
    const j = await db.journal.findUnique({ where: { id }, include: journalInclude });
    if (!j || j.companyId !== company.id) throw new NotFoundException('Journal not found');
    return j;
  }

  private dto(j: JournalRow) {
    const debit = j.lines.reduce((s, l) => s.add(D(l.debit)), new Decimal(0));
    return {
      id: j.id,
      number: j.number,
      kind: j.kind,
      journalDate: iso(j.journalDate),
      reference: j.reference,
      referenceDate: iso(j.referenceDate),
      remark: j.remark,
      status: j.status,
      ledgerEntryId: j.ledgerEntryId,
      total: debit.toFixed(2),
      postedAt: j.postedAt,
      cancelledAt: j.cancelledAt,
      cancelReason: j.cancelReason,
      lines: j.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        storeId: l.storeId,
        partyType: l.partyType,
        partyId: l.partyId,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        againstType: l.againstType,
        againstId: l.againstId,
        remark: l.remark,
      })),
    };
  }
}
