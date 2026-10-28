// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 1 (28 October 2026): shop separation, checked on every list the API has.
// Shop A fills in records of many kinds; shop B then calls every GET route that needs no
// id in its path, and no answer may carry the id of any of shop A's rows.
import type { INestApplication } from '@nestjs/common';
import { addDays, businessDate } from 'shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService, SystemPrisma } from '../../src/prisma/prisma.service.js';
import { runForCompany } from '../../src/prisma/tenancy.js';
import { type Agent, createTestApp, login, setUpCompany, SETUP_INPUT } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let A: Agent;
let B: Agent;
let companyA: string;
let companyB: string;

const OTHER = {
  ...SETUP_INPUT,
  admin: { firstName: 'Ravi', lastName: 'K', email: 'ravi@sweep-shop.test', password: 'Shop-two-pass-2026' },
  company: { legalName: 'Ravi Textiles', stateCode: '29', city: 'Bengaluru' },
  gstRegistration: { gstin: '29AAACR1234A1ZZ' },
};

/** Every GET route of the app whose path has no ":param". */
function listRoutes(): string[] {
  const instance = app.getHttpAdapter().getInstance() as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  const paths = new Set<string>();
  for (const layer of stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (layer.route?.methods.get && !layer.route.path.includes(':')) paths.add(layer.route.path);
  }
  return [...paths].sort();
}

async function fillShopA() {
  const units = (await A.get('/catalogue/units').expect(200)).body as { id: string; code: string }[];
  const pcs = units.find((u) => u.code === 'PCS')!.id;
  const group = (await A.post('/catalogue/item-groups').send({ code: 'FANCY', name: 'Fancy' }).expect(201)).body;
  await A.post('/catalogue/brands').send({ code: 'ACME', name: 'Acme' }).expect(201);
  await A.post('/pos/gst-rates').send({ hsnCode: '7117', rate: '3', effectiveFrom: '2026-04-01' }).expect(201);
  const item = (await A.post('/items').send({ name: 'Gold-plated earrings', itemGroupId: group.id, baseUnitId: pcs, hsnCode: '7117', mrp: '249', sellingPrice: '249' }).expect(201)).body;
  await A.post(`/items/${item.id}/barcodes`).send({ code: '8903000000006' }).expect(201);
  const groups = (await A.get('/customer-groups').expect(200)).body as { id: string; code: string }[];
  await A.post('/customers').send({ name: 'Priya Raman', mobile: '9840011001', customerGroupId: groups.find((g) => g.code === 'RETAIL')!.id }).expect(201);
  const supplierGroups = (await A.get('/supplier-groups').expect(200)).body as { id: string }[];
  const supplier = (await A.post('/suppliers').send({ name: 'Sri Murugan Traders', supplierGroupId: supplierGroups[0].id }).expect(201)).body;
  const stores = (await A.get('/stores').expect(200)).body as { id: string; code: string }[];
  const roles = (await A.get('/roles').expect(200)).body as { id: string; code: string }[];
  await A.post('/users').send({ firstName: 'Cashier', email: 'cashier@sweep-a.test', temporaryPassword: 'Temp-pass-1234', roleIds: [roles.find((r) => r.code === 'cashier')!.id], storeIds: [stores[0].id], defaultStoreId: stores[0].id }).expect(201);
  // Buying and stock.
  const order = (await A.post('/purchase/orders').send({ supplierId: supplier.id, storeId: stores[0].id, neededBy: addDays(businessDate(), 5), lines: [{ itemId: item.id, quantity: '10', rate: '100' }] }).expect(201)).body;
  await A.post(`/purchase/orders/${order.id}/finalise`).expect(200);
  const receipt = (await A.post('/purchase/receipts').send({ storeId: stores[0].id, supplierId: supplier.id, noOrderReason: 'Local purchase', lines: [{ itemId: item.id, receivedQuantity: '5', rate: '100', gstRate: '3' }] }).expect(201)).body;
  await A.post(`/purchase/receipts/${receipt.id}/finalise`).expect(200);
  await A.post('/markdowns').send({ itemIds: [item.id], rule: 'percent', value: '10', startDate: addDays(businessDate(), 3) });
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  A = await setUpCompany(app, prisma);
  companyA = (await A.get('/company').expect(200)).body.id;
  companyB = ((await request(app.getHttpServer()).post('/setup').send(OTHER).expect(201)).body as { companyId: string }).companyId;
  B = await login(app, OTHER.admin.email, OTHER.admin.password);
  await fillShopA();
});

afterAll(async () => {
  await app.close();
});

/** Ids of every row of these stores, from every table with a store column (shop A only). */
async function storeRowIds(storeIds: string[]): Promise<Set<string>> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
    WHERE c.table_schema = 'public' AND c.column_name = 'storeId'`;
  const ids = new Set<string>();
  for (const { table_name } of tables) {
    const rows = await prisma.$queryRawUnsafe<{ id: unknown }[]>(`SELECT "id"::text AS id FROM "${table_name}" WHERE "storeId" = ANY($1::uuid[])`, storeIds);
    for (const r of rows) if (typeof r.id === 'string' && r.id.length >= 32) ids.add(r.id);
  }
  return ids;
}

describe('audit 1: no list of the API ever shows another shop’s rows', () => {
  it("shop B calls every GET route; none carries an id of shop A's rows", async () => {
    // Every id of every row that belongs to shop A, from every table with a shop column.
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
      WHERE c.table_schema = 'public' AND c.column_name = 'companyId'`;
    const ids = new Set<string>([companyA]);
    for (const { table_name } of tables) {
      const rows = await prisma.$queryRawUnsafe<{ id: unknown }[]>(`SELECT "id"::text AS id FROM "${table_name}" WHERE "companyId" = $1::uuid`, companyA);
      for (const r of rows) if (typeof r.id === 'string' && r.id.length >= 32) ids.add(r.id);
    }
    expect(ids.size).toBeGreaterThan(50);
    expect(companyB).not.toBe(companyA);

    const routes = listRoutes();
    expect(routes.length).toBeGreaterThan(100);
    const leaks: string[] = [];
    let answered = 0;
    for (const path of routes) {
      const res = await B.get(path);
      if (res.status >= 500) leaks.push(`${path}: server error ${res.status}`);
      if (res.status !== 200) continue;
      answered++;
      const text = res.text ?? JSON.stringify(res.body);
      for (const id of ids) if (text.includes(id)) leaks.push(`${path}: shows ${id}`);
    }
    expect(leaks).toEqual([]);
    expect(answered).toBeGreaterThan(60);

    // The check can see a row when it is there: shop A's own lists show its ids on many routes.
    let own = 0;
    for (const path of routes) {
      const res = await A.get(path);
      if (res.status === 200 && [...ids].some((id) => (res.text ?? '').includes(id))) own++;
    }
    expect(own).toBeGreaterThan(30);
  });

  it('two shops looking up their own rows at the very same instant each find their own (the client may batch them)', async () => {
    const shop = app.get(PrismaService);
    const [a, b] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: companyA } }), prisma.company.findUniqueOrThrow({ where: { id: companyB } })]);
    void a;
    void b;
    const itemsA = await prisma.item.findMany({ where: { companyId: companyA }, select: { id: true } });
    const storesB = await prisma.store.findMany({ where: { companyId: companyB }, select: { id: true } });
    for (let round = 0; round < 20; round++) {
      // Started in the same tick, so Prisma may put both lookups into one query.
      const [ia, sb] = await Promise.all([
        runForCompany(companyA, () => shop.item.findUnique({ where: { id: itemsA[0].id } })),
        runForCompany(companyB, () => shop.store.findUnique({ where: { id: storesB[0].id } })),
      ]);
      expect(ia?.id).toBe(itemsA[0].id);
      expect(sb?.id).toBe(storesB[0].id);
      const [ia2, ib2] = await Promise.all([
        runForCompany(companyA, () => shop.item.findUnique({ where: { id: itemsA[0].id } })),
        runForCompany(companyB, () => shop.item.findUnique({ where: { id: itemsA[0].id } })),
      ]);
      expect(ia2?.id).toBe(itemsA[0].id);
      // Shop B never sees shop A's item, batched or not.
      expect(ib2).toBeNull();
    }
  });

  it("a store manager of Anna Nagar calls every GET route; none carries a Main store document", async () => {
    const made = await A.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    // Two shops are in the database: look up shop A's own store and role (both shops have a MAIN).
    const anna = (await prisma.store.findFirstOrThrow({ where: { code: 'ANNA', companyId: companyA } })).id;
    const main = (await prisma.store.findFirstOrThrow({ where: { code: 'MAIN', companyId: companyA } })).id;
    const manager = (await prisma.role.findFirstOrThrow({ where: { code: 'store_manager', companyId: companyA } })).id;
    const added = await A.post('/users').send({ firstName: 'Meena', email: 'meena@sweep-a.test', temporaryPassword: 'Temp-pass-1234', roleIds: [manager], storeIds: [anna], defaultStoreId: anna });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const meena = await login(app, 'meena@sweep-a.test', 'Temp-pass-1234');
    await meena.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Meena-own-pass-9' }).expect(204);
    // Main store's own records (the store row itself and its cash accounts are named on purpose, not secret).
    const ids = await storeRowIds([main]);
    for (const a of await prisma.account.findMany({ where: { storeId: main }, select: { id: true } })) ids.delete(a.id);
    for (const l of await prisma.stockLocation.findMany({ where: { storeId: main }, select: { id: true } })) ids.delete(l.id);
    expect(ids.size).toBeGreaterThan(2);
    const shown: string[] = [];
    for (const path of listRoutes()) {
      const res = await meena.get(path);
      if (res.status >= 500) shown.push(`${path}: server error ${res.status}`);
      if (res.status !== 200) continue;
      for (const id of ids) if ((res.text ?? '').includes(id)) shown.push(`${path}: shows ${id}`);
    }
    expect(shown).toEqual([]);
  });
});
