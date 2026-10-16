// Copyright (c) 2026, Rademics. All rights reserved.
// Shared helpers for the accounting module (plan 07).
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { type CurrentUser, Decimal } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { canAccessStore } from '../auth/store-access.js';
import { CompanyService } from '../company/company.service.js';
import type { Account, Company } from '../generated/prisma/client.js';
import { AccountingSetup } from '../ledger/accounting-setup.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const ACCOUNTING_NUMBER_SERIES: Record<string, string> = {
  journal: 'JV-{FY}-',
  receipt: 'RCT-{FY}-',
  payment: 'PAY-{FY}-',
  transfer: 'TRF-{FY}-',
};

type Amount = { toString(): string };
export const D = (v: Amount) => new Decimal(v.toString());
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class AccountingCommon {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: CompanyService,
    private readonly setup: AccountingSetup,
    private readonly numbering: NumberingService,
  ) {}

  /** The company, with its chart of accounts and number series in place. */
  async ready(db: Db = this.prisma): Promise<Company> {
    const company = await this.company.current(db);
    await this.setup.ensure(db, company.id);
    for (const [documentKind, pattern] of Object.entries(ACCOUNTING_NUMBER_SERIES)) {
      const exists = await db.numberSeries.findFirst({ where: { companyId: company.id, documentKind, storeId: null } });
      if (!exists) await db.numberSeries.create({ data: { companyId: company.id, documentKind, pattern, counterLength: 5 } });
    }
    return company;
  }

  allocate(tx: Db, companyId: string, documentKind: string, date: string): Promise<string> {
    return this.numbering.allocate(tx, { companyId, documentKind, date });
  }

  async yearFor(db: Db, companyId: string, date: string) {
    const fy = await db.financialYear.findFirst({ where: { companyId, startDate: { lte: fromIso(date) }, endDate: { gte: fromIso(date) } } });
    if (!fy) throw new BadRequestException(`No financial year covers ${date}`);
    return fy;
  }

  async account(db: Db, companyId: string, id: string): Promise<Account> {
    const a = await db.account.findUnique({ where: { id } });
    if (!a || a.companyId !== companyId) throw new BadRequestException('Account not found');
    return a;
  }

  /** Stores a user may see on ledgers and statements (store managers: their own stores only). */
  storeFilter(user: CurrentUser): string[] | undefined {
    return user.allStores || user.isOwnerAdmin ? undefined : user.stores.map((s) => s.id);
  }

  assertStore(user: CurrentUser, storeId: string | null | undefined) {
    if (storeId && !canAccessStore(user, storeId)) throw new ForbiddenException('You are not allowed to work in this store');
  }

  accountName(a: Pick<Account, 'number' | 'name'>) {
    return `${a.number ? `${a.number} ` : ''}${a.name}`;
  }
}
