// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Db } from '../audit/audit.service.js';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import { UnitsService } from '../catalogue/units.service.js';
import { ensureGstSettings } from '../gst/gst-core.service.js';
import { ensureCompanyInventory, ensureStoreLocations } from '../inventory/location-defaults.js';
import { PartySettingsService } from '../parties/party-settings.service.js';
import { ensurePosDefaults } from '../pos/pos-common.service.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { runForCompany } from '../prisma/tenancy.js';
import { ensurePurchaseDefaults } from '../purchasing/purchase-common.service.js';
import { RolesService } from '../roles/roles.service.js';

/**
 * Plan 14: everything a shop starts with — security settings, the six roles,
 * the standard units, customer and supplier groups and payment terms, and the
 * default settings of each module. Made when a shop signs up, and checked for
 * every shop at start-up (so a new default added later reaches existing shops).
 * Each part skips what already exists, so running it twice changes nothing.
 * Must run for one shop: inside its request, or `runForCompany`.
 */
@Injectable()
export class CompanyDefaults implements OnApplicationBootstrap {
  private readonly log = new Logger(CompanyDefaults.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly roles: RolesService,
    private readonly units: UnitsService,
    private readonly catalogueSettings: CatalogueSettingsService,
    private readonly partySettings: PartySettingsService,
  ) {}

  async ensureAll(db: Db, companyId: string): Promise<void> {
    await db.securitySettings.createMany({ data: [{}], skipDuplicates: true });
    await this.roles.ensureSystemRoles(db);
    await this.units.ensureStandardUnits(db);
    await this.partySettings.ensureStandardMasters(db);
    await this.catalogueSettings.ensureCompanyDefaults(db, companyId);
    await this.partySettings.ensureCompanyDefaults(db, companyId);
    await ensureCompanyInventory(db, companyId);
    for (const store of await db.store.findMany({ where: { companyId } })) await ensureStoreLocations(db, store);
    await ensurePurchaseDefaults(db, companyId);
    await ensurePosDefaults(db, companyId);
    await ensureGstSettings(db, companyId);
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const company of await this.system.company.findMany({ select: { id: true } })) {
      try {
        await runForCompany(company.id, () => this.ensureAll(this.prisma, company.id));
      } catch (err) {
        this.log.error(`Could not check the defaults of shop ${company.id}`, err instanceof Error ? err.stack : String(err));
      }
    }
  }
}
