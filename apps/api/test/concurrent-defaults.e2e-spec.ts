// Copyright (c) 2026, Rademics. All rights reserved.
// The "ensure defaults" functions run when the API starts and on first use, so
// two requests (or two API processes) can call them at the same moment. Each
// one is called many times at once here: none may fail and no row may be duplicated.
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from 'shared';
import { ACCOUNTING_NUMBER_SERIES, AccountingCommon } from '../src/accounting/accounting-common.service.js';
import { CatalogueSettingsService } from '../src/catalogue/catalogue-settings.service.js';
import { UnitsService } from '../src/catalogue/units.service.js';
import { ensureStoreLocations, STOCK_NUMBER_SERIES, seriesKind } from '../src/inventory/location-defaults.js';
import { PartySettingsService } from '../src/parties/party-settings.service.js';
import { SystemPrisma } from '../src/prisma/prisma.service.js';
import { ensurePurchaseDefaults, PURCHASE_NUMBER_SERIES } from '../src/purchasing/purchase-common.service.js';
import { RolesService } from '../src/roles/roles.service.js';
import { createTestApp, setUpCompany } from './helpers.js';

const AT_ONCE = 8;

let app: INestApplication<App>;
let prisma: SystemPrisma;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

/** Calls `fn` AT_ONCE times at the same moment; every call must succeed. */
async function atOnce(fn: () => Promise<unknown>): Promise<void> {
  const results = await Promise.allSettled(Array.from({ length: AT_ONCE }, fn));
  const failures = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
  expect(failures).toEqual([]);
}

/** Company-wide number series per document kind, for checking duplicates. */
async function companyWideSeries(companyId: string, kinds: string[]): Promise<Record<string, number>> {
  const rows = await prisma.numberSeries.groupBy({
    by: ['documentKind'],
    where: { companyId, storeId: null, documentKind: { in: kinds } },
    _count: true,
  });
  return Object.fromEntries(rows.map((r) => [r.documentKind, r._count]));
}

const once = (kinds: string[]) => Object.fromEntries(kinds.map((k) => [k, 1]));

describe("a shop's standard defaults, called at the same moment", () => {
  beforeAll(async () => {
    // Plan 14: the defaults belong to a shop; the tests' direct calls work for this first shop.
    await setUpCompany(app, prisma);
  });

  it('standard units and conversions', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "UnitConversion", "Unit" CASCADE');
    const units = app.get(UnitsService);
    await atOnce(() => units.ensureStandardUnits(prisma));
    expect(await prisma.unit.count()).toBe(10);
    expect(await prisma.unitConversion.count()).toBe(4);
  });

  it('system roles, each with its permissions once', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "Role" CASCADE');
    await atOnce(() => app.get(RolesService).ensureSystemRoles(prisma));
    const roles = await prisma.role.findMany({ include: { permissions: true } });
    expect(roles.map((r) => r.code).sort()).toEqual(Object.values(SYSTEM_ROLES).sort());
    for (const r of roles) {
      expect(r.permissions.map((p) => p.permissionKey).sort()).toEqual([...SYSTEM_ROLE_PERMISSIONS[r.code as keyof typeof SYSTEM_ROLE_PERMISSIONS]].sort());
    }
  });

  it('payment terms with one 100% part each, and groups with their paths', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PaymentTermsPart", "PaymentTerms", "CustomerGroup", "SupplierGroup" CASCADE');
    await atOnce(() => app.get(PartySettingsService).ensureStandardMasters(prisma));
    const terms = await prisma.paymentTerms.findMany({ include: { parts: true } });
    expect(terms.map((t) => t.code).sort()).toEqual(['CASH', 'NET15', 'NET30']);
    for (const t of terms) {
      expect(t.parts).toHaveLength(1);
      expect(t.parts[0].share.toString()).toBe('100');
    }
    const groups = [...(await prisma.customerGroup.findMany()), ...(await prisma.supplierGroup.findMany())];
    expect(groups).toHaveLength(7);
    for (const g of groups) expect(g.path).toBe(`/${g.id}/`);
  });
});

describe('company defaults, called at the same moment', () => {
  let companyId: string;

  beforeAll(async () => {
    await setUpCompany(app, prisma);
    companyId = (await prisma.company.findFirstOrThrow()).id;
  });

  it('allows only one company-wide number series per document kind', async () => {
    const data = { companyId, documentKind: 'race_check', pattern: 'RC-', counterLength: 5 };
    await prisma.numberSeries.create({ data });
    await expect(prisma.numberSeries.create({ data })).rejects.toThrow();
    await prisma.numberSeries.deleteMany({ where: { documentKind: 'race_check' } });
  });

  it('purchase settings and number series', async () => {
    const kinds = Object.keys(PURCHASE_NUMBER_SERIES);
    await prisma.purchaseSettings.deleteMany();
    await prisma.numberSeries.deleteMany({ where: { companyId, documentKind: { in: kinds } } });
    await atOnce(() => ensurePurchaseDefaults(prisma, companyId));
    expect(await prisma.purchaseSettings.count()).toBe(1);
    expect(await companyWideSeries(companyId, kinds)).toEqual(once(kinds));
  });

  it('stock locations, inventory settings and number series', async () => {
    const kinds = Object.keys(STOCK_NUMBER_SERIES).map(seriesKind);
    await prisma.inventorySettings.deleteMany();
    await prisma.stockLocation.deleteMany({ where: { parentId: { not: null } } });
    await prisma.stockLocation.deleteMany();
    await prisma.numberSeries.deleteMany({ where: { companyId, documentKind: { in: kinds } } });
    const store = await prisma.store.findFirstOrThrow({ where: { code: 'MAIN' } });
    await atOnce(() => ensureStoreLocations(prisma, store));
    expect(await prisma.inventorySettings.count()).toBe(1);
    expect((await prisma.stockLocation.findMany({ orderBy: { code: 'asc' } })).map((l) => l.code)).toEqual(['MAIN', 'MAIN-BACK', 'MAIN-FLOOR', 'MAIN-REJECT', 'TRANSIT']);
    expect(await companyWideSeries(companyId, kinds)).toEqual(once(kinds));
  });

  it('catalogue settings, standard price lists and the item number series', async () => {
    await prisma.catalogueSettings.deleteMany();
    await prisma.priceList.deleteMany();
    await prisma.numberSeries.deleteMany({ where: { companyId, documentKind: 'item' } });
    await atOnce(() => app.get(CatalogueSettingsService).ensureCompanyDefaults(prisma, companyId));
    expect(await prisma.catalogueSettings.count()).toBe(1);
    expect((await prisma.priceList.findMany({ orderBy: { code: 'asc' } })).map((p) => p.code)).toEqual(['STD-BUY', 'STD-SELL']);
    expect(await companyWideSeries(companyId, ['item'])).toEqual(once(['item']));
  });

  it('chart of accounts and the accounting number series', async () => {
    const kinds = Object.keys(ACCOUNTING_NUMBER_SERIES);
    await prisma.numberSeries.deleteMany({ where: { companyId, documentKind: { in: kinds } } });
    await atOnce(() => app.get(AccountingCommon).ready(prisma));
    expect(await companyWideSeries(companyId, kinds)).toEqual(once(kinds));
    expect(await prisma.accountingSettings.count()).toBe(1);
  });

  it('party settings, the walk-in customer and number series', async () => {
    const kinds = ['customer', 'supplier'];
    await prisma.partySettings.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.numberSeries.deleteMany({ where: { companyId, documentKind: { in: kinds } } });
    await atOnce(() => app.get(PartySettingsService).ensureCompanyDefaults(prisma, companyId));
    const settings = await prisma.partySettings.findMany();
    const customers = await prisma.customer.findMany();
    expect(settings).toHaveLength(1);
    expect(customers).toHaveLength(1);
    expect(customers[0].isWalkIn).toBe(true);
    expect(settings[0].walkInCustomerId).toBe(customers[0].id);
    expect(await companyWideSeries(companyId, kinds)).toEqual(once(kinds));
  });
});
