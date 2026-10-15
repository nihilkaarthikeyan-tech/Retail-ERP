// Copyright (c) 2026, Rademics. All rights reserved.
// Shared helpers for the end-to-end and acceptance tests.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { SetupInput } from 'shared';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { UnitsService } from '../src/catalogue/units.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());
  await app.init();
  return app;
}

/** Empties every table (TRUNCATE is allowed on the history table; row deletes are not). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "Session", "UserStore", "UserRole", "RolePermission", "Role", "User",
      "NumberSeriesCounter", "NumberSeries", "FinancialYear", "Store", "GstRegistration",
      "Price", "PriceList", "CatalogueSettings", "Barcode", "ItemUnit", "ItemVariantValue",
      "ItemVariantAttribute", "Item", "VariantAttributeValue", "VariantAttribute", "HsnCode",
      "Brand", "ItemGroup", "UnitConversion", "Unit",
      "Address", "ContactPerson", "Customer", "CustomerGroup", "Supplier", "SupplierGroup",
      "PaymentTermsPart", "PaymentTerms", "PartySettings",
      "Company", "SecuritySettings"
    RESTART IDENTITY CASCADE`);
  await prisma.securitySettings.create({ data: { id: 1 } });
  await new UnitsService(prisma, new AuditService(prisma)).ensureStandardUnits(prisma);
}

export const OWNER = {
  firstName: 'Karthik',
  lastName: 'R',
  email: 'owner@rademics.test',
  password: 'Owner-pass-2026',
};

/** Scenario 1.1 input: Rademics Retail Pvt Ltd, Tamil Nadu, FY 2026-27, store MAIN. */
export const SETUP_INPUT: SetupInput = {
  admin: OWNER,
  company: {
    legalName: 'Rademics Retail Pvt Ltd',
    stateCode: '33',
    city: 'Chennai',
  },
  gstRegistration: { gstin: '33AAACR1234A1ZV' },
  financialYear: { startDate: '2026-04-01', endDate: '2027-03-31' },
  store: { code: 'MAIN', name: 'Main Store' },
};

export type Agent = ReturnType<typeof request.agent>;

/** A supertest agent that keeps the session cookie between requests. */
export function agent(app: INestApplication<App>): Agent {
  return request.agent(app.getHttpServer());
}

export async function login(app: INestApplication<App>, email: string, password: string): Promise<Agent> {
  const a = agent(app);
  await a.post('/auth/login').send({ email, password }).expect(200);
  return a;
}

/** Fresh database with setup completed and the owner logged in. */
export async function setUpCompany(app: INestApplication<App>, prisma: PrismaService): Promise<Agent> {
  await resetDatabase(prisma);
  await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(201);
  return login(app, OWNER.email, OWNER.password);
}

export async function roleId(prisma: PrismaService, code: string): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
}

export async function storeId(prisma: PrismaService, code: string): Promise<string> {
  return (await prisma.store.findFirstOrThrow({ where: { code } })).id;
}
