// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable } from '@nestjs/common';
import type { UpdateCatalogueSettingsInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { CatalogueSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnitsService } from './units.service.js';

export const ITEM_NUMBER_SERIES = { documentKind: 'item', pattern: 'ITM-', counterLength: 6 };

@Injectable()
export class CatalogueSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly units: UnitsService,
  ) {}

  /** Databases set up before module 2 get their defaults on the first start. */

  /**
   * Idempotent per-company defaults: Standard Selling and Standard Buying
   * price lists, the settings row pointing at them, and the item number series.
   * Safe when several requests ask at the same moment: rows that already exist are skipped, never an error.
   */
  async ensureCompanyDefaults(db: Db, companyId: string): Promise<CatalogueSettings> {
    await db.priceList.createMany({
      data: [
        { companyId, code: 'STD-SELL', name: 'Standard Selling', forSelling: true, forBuying: false },
        { companyId, code: 'STD-BUY', name: 'Standard Buying', forSelling: false, forBuying: true },
      ],
      skipDuplicates: true,
    });
    const selling = await db.priceList.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'STD-SELL' } } });
    const buying = await db.priceList.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'STD-BUY' } } });
    const pcs = await db.unit.findFirst({ where: { code: 'PCS' } });
    await db.catalogueSettings.createMany({
      data: [{ companyId, defaultSellingPriceListId: selling.id, defaultBuyingPriceListId: buying.id, defaultUnitId: pcs?.id ?? null }],
      skipDuplicates: true,
    });
    await db.numberSeries.createMany({ data: [{ companyId, ...ITEM_NUMBER_SERIES }], skipDuplicates: true });
    return db.catalogueSettings.findUniqueOrThrow({ where: { companyId } });
  }

  async get(db: Db = this.prisma): Promise<CatalogueSettings> {
    const company = await this.company.current(db);
    return (await db.catalogueSettings.findUnique({ where: { companyId: company.id } })) ?? this.ensureCompanyDefaults(db, company.id);
  }

  async update(input: UpdateCatalogueSettingsInput, actor: Actor) {
    const before = await this.get();
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.catalogueSettings.update({ where: { companyId: before.companyId }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'catalogue_settings', before.companyId, before, after);
      return after;
    });
  }
}
