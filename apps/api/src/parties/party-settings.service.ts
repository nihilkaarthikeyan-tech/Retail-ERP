// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Decimal, type UpdatePartySettingsInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { PartySettings } from '../generated/prisma/client.js';
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
export class PartySettingsService implements OnModuleInit {
  private readonly log = new Logger(PartySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureStandardMasters(this.prisma);
      for (const c of await this.prisma.company.findMany({ select: { id: true } })) {
        await this.ensureCompanyDefaults(this.prisma, c.id);
      }
    } catch (err) {
      this.log.error('Could not ensure party defaults', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Idempotent: standard payment terms and starting groups (also in the migration). */
  async ensureStandardMasters(db: Db): Promise<void> {
    for (const t of STANDARD_TERMS) {
      const terms = await db.paymentTerms.upsert({ where: { code: t.code }, create: { code: t.code, name: t.name }, update: {} });
      if ((await db.paymentTermsPart.count({ where: { paymentTermsId: terms.id } })) === 0) {
        await db.paymentTermsPart.create({
          data: { paymentTermsId: terms.id, share: new Decimal(100), dueBasis: 'days_after_date', days: t.days },
        });
      }
    }
    for (const [code, name] of CUSTOMER_GROUPS) {
      const g = await db.customerGroup.upsert({ where: { code }, create: { code, name, path: '' }, update: {} });
      if (!g.path) await db.customerGroup.update({ where: { id: g.id }, data: { path: `/${g.id}/` } });
    }
    for (const [code, name] of SUPPLIER_GROUPS) {
      const g = await db.supplierGroup.upsert({ where: { code }, create: { code, name, path: '' }, update: {} });
      if (!g.path) await db.supplierGroup.update({ where: { id: g.id }, data: { path: `/${g.id}/` } });
    }
  }

  /** Idempotent per company: settings row, walk-in customer, number series. */
  async ensureCompanyDefaults(db: Db, companyId: string): Promise<PartySettings> {
    const retail = await db.customerGroup.findUnique({ where: { code: 'RETAIL' } });
    const local = await db.supplierGroup.findUnique({ where: { code: 'LOCAL' } });
    const cash = await db.paymentTerms.findUnique({ where: { code: 'CASH' } });
    let settings = await db.partySettings.upsert({
      where: { companyId },
      create: {
        companyId,
        defaultCustomerGroupId: retail?.id ?? null,
        defaultSupplierGroupId: local?.id ?? null,
        defaultPaymentTermsId: cash?.id ?? null,
      },
      update: {},
    });
    for (const series of [CUSTOMER_NUMBER_SERIES, SUPPLIER_NUMBER_SERIES]) {
      const exists = await db.numberSeries.findFirst({ where: { companyId, documentKind: series.documentKind, storeId: null } });
      if (!exists) await db.numberSeries.create({ data: { companyId, ...series } });
    }
    if (!settings.walkInCustomerId && retail) {
      const code = `${WALK_IN_CODE}-${(await db.company.findUniqueOrThrow({ where: { id: companyId } })).code}`;
      const walkIn =
        (await db.customer.findUnique({ where: { code } })) ??
        (await db.customer.create({
          data: { companyId, code, name: 'Walk-in customer', customerGroupId: retail.id, isWalkIn: true, paymentTermsId: cash?.id ?? null },
        }));
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
