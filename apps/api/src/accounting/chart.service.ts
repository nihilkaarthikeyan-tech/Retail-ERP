// Copyright (c) 2026, Rademics. All rights reserved.
// Chart of accounts, default accounts, bank accounts and the CA's approval
// (plan 07 §1.1, §1.5; blueprint 11 "Accounts" business rules).
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  ACCOUNT_ROLES,
  type BankAccountInput,
  type CreateAccountInput,
  type CurrentUser,
  Decimal,
  hasPermission,
  naturalBalance,
  type SetDefaultsInput,
  type UpdateAccountInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Account } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, iso } from './accounting-common.service.js';

@Injectable()
export class ChartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
  ) {}

  /** The whole chart with each account's balance (folders add up their children). */
  async tree(user: CurrentUser) {
    const company = await this.common.ready();
    const accounts = await this.prisma.account.findMany({ where: { companyId: company.id }, orderBy: [{ number: 'asc' }, { name: 'asc' }] });
    const stores = this.common.storeFilter(user);
    const sums = await this.prisma.ledgerLine.groupBy({
      by: ['accountId'],
      where: { companyId: company.id, ...(stores ? { storeId: { in: stores } } : {}) },
      _sum: { debit: true, credit: true },
    });
    const own = new Map(sums.map((s) => [s.accountId, D(s._sum.debit ?? 0).sub(D(s._sum.credit ?? 0))]));
    const children = new Map<string, Account[]>();
    for (const a of accounts) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
    const total = (a: Account): Decimal => (children.get(a.id) ?? []).reduce((s, c) => s.add(total(c)), own.get(a.id) ?? new Decimal(0));
    const settings = await this.prisma.accountingSettings.findUnique({ where: { companyId: company.id } });
    const defaults = await this.prisma.accountDefault.findMany({ where: { companyId: company.id } });
    const usedFor = new Map<string, string[]>();
    for (const d of defaults) usedFor.set(d.accountId, [...(usedFor.get(d.accountId) ?? []), d.role]);
    return {
      approval: settings?.chartApprovedAt ? { approvedAt: settings.chartApprovedAt, approvedById: settings.chartApprovedById, note: settings.chartApprovalNote } : null,
      accounts: accounts.map((a) => {
        const dr = total(a);
        return { ...this.dto(a), balance: naturalBalance(a.family, dr.gt(0) ? dr : 0, dr.lt(0) ? dr.neg() : 0).toFixed(2), debitMinusCredit: dr.toFixed(2), usedFor: usedFor.get(a.id) ?? [] };
      }),
    };
  }

  async create(input: CreateAccountInput, actor: Actor) {
    const company = await this.common.ready();
    const parent = await this.common.account(this.prisma, company.id, input.parentId);
    if (!parent.isGroup) throw new BadRequestException('Accounts can only be added under a folder');
    if (input.isGroup && input.kind) throw new BadRequestException('A folder has no kind');
    if (!input.isGroup && !input.kind) throw new BadRequestException('Choose what kind of account it is');
    await this.checkNumber(this.prisma, company.id, input.number ?? null, null);
    if (input.kind === 'bank' && input.isGroup) throw new BadRequestException('A bank account cannot be a folder');
    const created = await this.prisma.$transaction(async (tx) => {
      const a = await tx.account.create({
        data: {
          companyId: company.id,
          parentId: parent.id,
          number: input.number?.trim() || null,
          name: input.name,
          isGroup: input.isGroup,
          family: parent.family,
          kind: input.isGroup ? null : (input.kind ?? null),
          storeId: input.storeId ?? null,
          balanceMustBe: input.balanceMustBe ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'account', entityId: a.id, changes: { number: a.number, name: a.name, parent: parent.name, kind: a.kind } });
      return a;
    });
    return this.dto(created);
  }

  async update(id: string, input: UpdateAccountInput, actor: Actor) {
    const company = await this.common.ready();
    const before = await this.common.account(this.prisma, company.id, id);
    if (!before.parentId && (input.parentId !== undefined || input.kind !== undefined || input.active === false)) throw new BadRequestException('Top-level folders cannot be moved, changed or switched off');
    const used = (await this.prisma.ledgerLine.count({ where: { accountId: id } })) > 0;
    let parentId = before.parentId;
    if (input.parentId !== undefined && input.parentId !== before.parentId) {
      const parent = await this.common.account(this.prisma, company.id, input.parentId);
      if (!parent.isGroup) throw new BadRequestException('The new parent must be a folder');
      if (parent.family !== before.family) throw new BadRequestException('An account cannot move to another family (assets, liabilities, capital, income, expenses)');
      // An account cannot sit under itself or under one of its own accounts.
      for (let p: Account | null = parent; p; p = p.parentId ? await this.prisma.account.findUnique({ where: { id: p.parentId } }) : null) {
        if (p.id === id) throw new BadRequestException('An account cannot sit under itself');
      }
      parentId = parent.id;
    }
    if (input.kind !== undefined && input.kind !== before.kind) {
      if (before.isGroup) throw new BadRequestException('A folder has no kind');
      if (!input.kind) throw new BadRequestException('Choose what kind of account it is');
      if (used && ['receivable', 'payable', 'stock'].includes(before.kind ?? '')) throw new BadRequestException('Customer, supplier and stock accounts cannot change kind once used');
    }
    if (input.number !== undefined) await this.checkNumber(this.prisma, company.id, input.number, id);
    if (input.active === false) {
      if (before.isGroup && (await this.prisma.account.count({ where: { parentId: id, active: true } }))) throw new BadRequestException('Switch off the accounts in this folder first');
      if (await this.prisma.accountDefault.count({ where: { accountId: id } })) throw new BadRequestException('This account is a default account; choose another default first');
    }
    const after = await this.prisma.$transaction(async (tx) => {
      const a = await tx.account.update({
        where: { id },
        data: {
          parentId,
          number: input.number === undefined ? undefined : input.number?.trim() || null,
          name: input.name,
          kind: input.kind === undefined ? undefined : input.kind,
          balanceMustBe: input.balanceMustBe === undefined ? undefined : input.balanceMustBe,
          active: input.active,
          updatedById: actor.userId,
        },
      });
      await this.audit.recordUpdate(tx, actor, 'account', id, this.summary(before), this.summary(a), null);
      return a;
    });
    return this.dto(after);
  }

  /** Only the trusted role may lock or unlock an account (blueprint 11). */
  async lock(id: string, locked: boolean, actor: Actor, user: CurrentUser) {
    if (!hasPermission(user, 'books.lock')) throw new ForbiddenException('Only the Accountant may lock or unlock accounts');
    const company = await this.common.ready();
    const before = await this.common.account(this.prisma, company.id, id);
    const after = await this.prisma.$transaction(async (tx) => {
      const a = await tx.account.update({ where: { id }, data: { locked, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'account', entityId: id, changes: { locked: { old: before.locked, new: locked }, name: a.name } });
      return a;
    });
    return this.dto(after);
  }

  /** Decision 55: the Owner records that the Chartered Accountant approved the chart. */
  async approveChart(note: string, actor: Actor) {
    const company = await this.common.ready();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountingSettings.update({ where: { companyId: company.id }, data: { chartApprovedAt: new Date(), chartApprovedById: actor.userId, chartApprovalNote: note, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'accounting_settings', entityId: company.id, changes: { chartApproved: note } });
    });
    return this.settings();
  }

  async settings() {
    const company = await this.common.ready();
    const s = await this.prisma.accountingSettings.findUniqueOrThrow({ where: { companyId: company.id } });
    return { chartApprovedAt: s.chartApprovedAt, chartApprovedById: s.chartApprovedById, chartApprovalNote: s.chartApprovalNote, ageingBands: s.ageingBands, lockDate: iso(company.lockDate) };
  }

  // ---- Default accounts ----

  async defaults() {
    const company = await this.common.ready();
    const rows = await this.prisma.accountDefault.findMany({ where: { companyId: company.id }, include: { account: true } });
    return Object.entries(ACCOUNT_ROLES).map(([role, label]) => {
      const r = rows.find((x) => x.role === role);
      return { role, label, account: r ? this.dto(r.account) : null };
    });
  }

  async setDefaults(input: SetDefaultsInput, actor: Actor) {
    const company = await this.common.ready();
    await this.prisma.$transaction(async (tx) => {
      for (const d of input.defaults) {
        const a = await this.common.account(tx, company.id, d.accountId);
        if (a.isGroup || !a.active) throw new BadRequestException(`${a.name}: choose an account in use, not a folder`);
        if (d.role === 'customer_receivable' && a.kind !== 'receivable') throw new BadRequestException('Customer balances must post to a customer balances account');
        if (d.role === 'supplier_payable' && a.kind !== 'payable') throw new BadRequestException('Supplier balances must post to a supplier balances account');
        if (d.role === 'stock' && a.kind !== 'stock') throw new BadRequestException('Stock must post to a stock account');
        const before = await tx.accountDefault.findUnique({ where: { companyId_role: { companyId: company.id, role: d.role } } });
        await tx.accountDefault.upsert({
          where: { companyId_role: { companyId: company.id, role: d.role } },
          create: { companyId: company.id, role: d.role, accountId: a.id, createdById: actor.userId, updatedById: actor.userId },
          update: { accountId: a.id, updatedById: actor.userId },
        });
        if (before?.accountId !== a.id) await this.audit.record(tx, actor, { action: 'update', entityType: 'account_default', entityId: company.id, changes: { role: d.role, account: { old: before?.accountId ?? null, new: a.id } } });
      }
    });
    return this.defaults();
  }

  // ---- Bank accounts ----

  async bankAccounts() {
    const company = await this.common.ready();
    const rows = await this.prisma.bankAccount.findMany({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }] });
    const accounts = new Map((await this.prisma.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } } })).map((a) => [a.id, a]));
    return rows.map((r) => this.bankDto(r, accounts.get(r.accountId)!));
  }

  async createBankAccount(input: BankAccountInput, actor: Actor) {
    const company = await this.common.ready();
    const a = await this.common.account(this.prisma, company.id, input.accountId);
    if (a.kind !== 'bank' || a.isGroup) throw new BadRequestException('Link the bank details to a bank account in the chart');
    if (await this.prisma.bankAccount.findUnique({ where: { accountId: a.id } })) throw new BadRequestException('That ledger account already has bank details');
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.bankAccount.updateMany({ where: { companyId: company.id }, data: { isDefault: false } });
      const b = await tx.bankAccount.create({ data: { companyId: company.id, ...input, ifsc: input.ifsc ?? null, branch: input.branch ?? null, createdById: actor.userId, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'bank_account', entityId: b.id, changes: { bank: b.bankName, account: mask(b.accountNumber) } });
      return b;
    });
    return this.bankDto(row, a);
  }

  async updateBankAccount(id: string, input: Partial<BankAccountInput> & { active?: boolean }, actor: Actor) {
    const company = await this.common.ready();
    const before = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!before || before.companyId !== company.id) throw new BadRequestException('Bank account not found');
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.bankAccount.updateMany({ where: { companyId: company.id }, data: { isDefault: false } });
      const b = await tx.bankAccount.update({ where: { id }, data: { bankName: input.bankName, accountNumber: input.accountNumber, ifsc: input.ifsc, branch: input.branch, isDefault: input.isDefault, active: input.active, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'bank_account', entityId: id, changes: { bank: b.bankName, account: mask(b.accountNumber) } });
      return b;
    });
    return this.bankDto(row, await this.common.account(this.prisma, company.id, row.accountId));
  }

  // ---- Helpers ----

  private async checkNumber(db: Db, companyId: string, number: string | null, selfId: string | null) {
    if (!number?.trim()) return;
    const clash = await db.account.findFirst({ where: { companyId, number: number.trim(), ...(selfId ? { id: { not: selfId } } : {}) } });
    if (clash) throw new BadRequestException(`Account number ${number} is already used by ${clash.name}`);
  }

  private summary(a: Account) {
    return { number: a.number, name: a.name, parentId: a.parentId, kind: a.kind, balanceMustBe: a.balanceMustBe, active: a.active, locked: a.locked };
  }

  dto(a: Account) {
    return {
      id: a.id,
      parentId: a.parentId,
      number: a.number,
      name: a.name,
      isGroup: a.isGroup,
      family: a.family,
      kind: a.kind,
      storeId: a.storeId,
      balanceMustBe: a.balanceMustBe,
      locked: a.locked,
      active: a.active,
      systemKey: a.systemKey,
    };
  }

  private bankDto(b: { id: string; accountId: string; bankName: string; accountNumber: string; ifsc: string | null; branch: string | null; isDefault: boolean; active: boolean }, a: Account) {
    return { id: b.id, account: this.dto(a), bankName: b.bankName, accountNumber: b.accountNumber, maskedNumber: mask(b.accountNumber), ifsc: b.ifsc, branch: b.branch, isDefault: b.isDefault, active: b.active };
  }
}

/** Only the last four digits are shown in lists and the history. */
export function mask(n: string): string {
  return n.length <= 4 ? n : `${'•'.repeat(Math.min(8, n.length - 4))}${n.slice(-4)}`;
}
