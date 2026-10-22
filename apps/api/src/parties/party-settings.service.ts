// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable } from '@nestjs/common';
import { Decimal, type UpdatePartySettingsInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { PartySettings } from '../generated/prisma/client.js';
import { inTransaction } from '../prisma/in-transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const CUSTOMER_NUMBER_SERIES = { documentKind: 'customer', pattern: 'CUS-', counterLength: 6 };
export const SUPPLIER_NUMBER_SERIES = { documentKind: 'supplier', pattern: 'SUP-', counterLength: 6 };
export const WALK_IN_CODE = 'WALK-IN';

const STANDARD_TERMS: { code: string; name: string; days: number }[] = [
  { code: 'CASH', name: 'Cash', days: 0 },
  { code: 'NET15', name: 'Net 15', days: 15 },
  { code: 'NET30', name: 'Net 30', days: 30 },
];
const CUSTOMER_GROUPS = [
  ['RETAIL', 'Retail'],
  ['WHOLESALE', 'Wholesale'],
  ['STAFF', 'Staff'],
];
const SUPPLIER_GROUPS = [
  ['DISTRIBUTORS', 'Distributors'],
  ['LOCAL', 'Local vendors'],
  ['SERVICES', 'Services'],
  ['TRANSPORT', 'Transporters'],
];

@Injectable()
export class PartySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}


  /**
   * Idempotent: standard payment terms and starting groups (also in the migration).
   * Safe when called at the same moment: each new row is added in one transaction with its
   * parts or path, and only by the caller whose insert actually created it.
   */
  async ensureStandardMasters(db: Db): Promise<void> {
    await inTransaction(db, async (tx) => {
      const terms = await tx.paymentTerms.createManyAndReturn({
        data: STANDARD_TERMS.map((t) => ({ code: t.code, name: t.name })),
        skipDuplicates: true,
        select: { id: true, code: true },
      });
      await tx.paymentTermsPart.createMany({
        data: terms.map((terms) => ({
          paymentTermsId: terms.id,
          share: new Decimal(100),
          dueBasis: 'days_after_date' as const,
          days: STANDARD_TERMS.find((t) => t.code === terms.code)!.days,
        })),
      });
      const customerGroups = await tx.customerGroup.createManyAndReturn({
        data: CUSTOMER_GROUPS.map(([code, name]) => ({ code, name, path: '' })),
        skipDuplicates: true,
        select: { id: true },
      });
      for (const g of customerGroups) await tx.customerGroup.update({ where: { id: g.id }, data: { path: `/${g.id}/` } });
      const supplierGroups = await tx.supplierGroup.createManyAndReturn({
        data: SUPPLIER_GROUPS.map(([code, name]) => ({ code, name, path: '' })),
        skipDuplicates: true,
        select: { id: true },
      });
      for (const g of supplierGroups) await tx.supplierGroup.update({ where: { id: g.id }, data: { path: `/${g.id}/` } });
    });
  }

  /**
   * Idempotent per company: settings row, walk-in customer, number series.
   * Safe when several requests ask at the same moment: rows that already exist are skipped, never an error.
   */
  async ensureCompanyDefaults(db: Db, companyId: string): Promise<PartySettings> {
    const retail = await db.customerGroup.findFirst({ where: { code: 'RETAIL' } });
    const local = await db.supplierGroup.findFirst({ where: { code: 'LOCAL' } });
    const cash = await db.paymentTerms.findFirst({ where: { code: 'CASH' } });
    await db.partySettings.createMany({
      data: [
        {
          companyId,
          defaultCustomerGroupId: retail?.id ?? null,
          defaultSupplierGroupId: local?.id ?? null,
          defaultPaymentTermsId: cash?.id ?? null,
        },
      ],
      skipDuplicates: true,
    });
    await db.numberSeries.createMany({ data: [CUSTOMER_NUMBER_SERIES, SUPPLIER_NUMBER_SERIES].map((series) => ({ companyId, ...series })), skipDuplicates: true });
    let settings = await db.partySettings.findUniqueOrThrow({ where: { companyId } });
    if (!settings.walkInCustomerId && retail) {
      const code = `${WALK_IN_CODE}-${(await db.company.findUniqueOrThrow({ where: { id: companyId } })).code}`;
      await db.customer.createMany({
        data: [{ companyId, code, name: 'Walk-in customer', customerGroupId: retail.id, isWalkIn: true, paymentTermsId: cash?.id ?? null }],
        skipDuplicates: true,
      });
      const walkIn = await db.customer.findFirstOrThrow({ where: { code } });
      // Every caller links the same customer, so a second update at the same moment changes nothing.
      settings = await db.partySettings.update({ where: { companyId }, data: { walkInCustomerId: walkIn.id } });
    }
    return settings;
  }

  async get(db: Db = this.prisma): Promise<PartySettings> {
    const company = await this.company.current(db);
    return (await db.partySettings.findUnique({ where: { companyId: company.id } })) ?? this.ensureCompanyDefaults(db, company.id);
  }

  async update(input: UpdatePartySettingsInput, actor: Actor) {
    const before = await this.get();
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.partySettings.update({
        where: { companyId: before.companyId },
        data: {
          ...input,
          defaultCreditLimit: input.defaultCreditLimit === undefined ? undefined : new Decimal(input.defaultCreditLimit),
          updatedById: actor.userId,
        },
      });
      await this.audit.recordUpdate(tx, actor, 'party_settings', before.companyId, before, after);
      return after;
    });
  }
}
