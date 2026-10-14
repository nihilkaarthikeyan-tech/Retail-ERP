// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { UpdateCatalogueSettingsInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { CatalogueSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnitsService } from './units.service.js';

export const ITEM_NUMBER_SERIES = { documentKind: 'item', pattern: 'ITM-', counterLength: 6 };

@Injectable()
export class CatalogueSettingsService implements OnModuleInit {
  private readonly log = new Logger(CatalogueSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly units: UnitsService,
  ) {}

  /** Databases set up before module 2 get their defaults on the first start. */
  async onModuleInit(): Promise<void> {
    try {
      await this.units.ensureStandardUnits(this.prisma);
      const companies = await this.prisma.company.findMany({ select: { id: true } });
      for (const c of companies) await this.ensureCompanyDefaults(this.prisma, c.id);
    } catch (err) {
      this.log.error('Could not ensure catalogue defaults', err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * Idempotent per-company defaults: Standard Selling and Standard Buying
   * price lists, the settings row pointing at them, and the item number series.
   */
  async ensureCompanyDefaults(db: Db, companyId: string): Promise<CatalogueSettings> {
    const selling = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'STD-SELL' } },
      create: { companyId, code: 'STD-SELL', name: 'Standard Selling', forSelling: true, forBuying: false },
      update: {},
    });
    const buying = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'STD-BUY' } },
      create: { companyId, code: 'STD-BUY', name: 'Standard Buying', forSelling: false, forBuying: true },
      update: {},
    });
    const pcs = await db.unit.findUnique({ where: { code: 'PCS' } });
    const settings = await db.catalogueSettings.upsert({
      where: { companyId },
      create: {
        companyId,
        defaultSellingPriceListId: selling.id,
        defaultBuyingPriceListId: buying.id,
        defaultUnitId: pcs?.id ?? null,
      },
      update: {},
    });
    const series = await db.numberSeries.findFirst({ where: { companyId, documentKind: ITEM_NUMBER_SERIES.documentKind, storeId: null } });
    if (!series) {
      await db.numberSeries.create({ data: { companyId, ...ITEM_NUMBER_SERIES } });
    }
    return settings;
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
