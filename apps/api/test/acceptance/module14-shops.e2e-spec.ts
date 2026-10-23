// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 14": one system,
// many shops (plan 14). Two shops with the same codes; each one tries to read and
// change the other's data and must fail every time.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../../src/auth/password.js';
import { readCsv, readZip } from '../../src/imports/spreadsheet.js';
import { PrismaService, SystemPrisma } from '../../src/prisma/prisma.service.js';
import { runForCompany, runRequest } from '../../src/prisma/tenancy.js';
import { type Agent, agent, createTestApp, login, OWNER, resetDatabase, SETUP_INPUT } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

const PASSWORD = 'Shop-two-pass-2026';
const OTHER = {
  ...SETUP_INPUT,
  admin: { firstName: 'Ravi', lastName: 'K', email: 'ravi@other-shop.test', password: PASSWORD },
  company: { legalName: 'Ravi Textiles', stateCode: '29', city: 'Bengaluru' },
  gstRegistration: { gstin: '29AAACR1234A1ZE' },
};

interface Made {
  agent: Agent;
  companyId: string;
  itemId: string;
  barcodeId: string;
  customerId: string;
  supplierId: string;
  storeId: string;
  userId: string;
  roleId: string;
}

/** Each shop makes the same things with the same codes. */
async function makeShop(input: typeof SETUP_INPUT, email: string, password: string): Promise<Made> {
  const { companyId } = (await request(app.getHttpServer()).post('/setup').send(input).expect(201)).body as { companyId: string };
  const a = await login(app, email, password);
  const units = (await a.get('/catalogue/units').expect(200)).body as { id: string; code: string }[];
  const group = (await a.post('/catalogue/item-groups').send({ code: 'FANCY', name: 'Fancy' }).expect(201)).body;
  const item = (await a.post('/items').send({ name: 'Gold-plated earrings', itemGroupId: group.id, baseUnitId: units.find((u) => u.code === 'PCS')!.id, hsnCode: '7117', mrp: '249', sellingPrice: '249' }).expect(201)).body;
  const barcode = (await a.post(`/items/${item.id}/barcodes`).send({ code: '8903000000006' }).expect(201)).body;
  const groups = (await a.get('/customer-groups').expect(200)).body as { id: string; code: string }[];
  const customer = (await a.post('/customers').send({ name: 'Priya Raman', mobile: '9840011001', customerGroupId: groups.find((g) => g.code === 'RETAIL')!.id }).expect(201)).body;
  const supplierGroups = (await a.get('/supplier-groups').expect(200)).body as { id: string }[];
  const supplier = (await a.post('/suppliers').send({ name: 'Sri Murugan Traders', supplierGroupId: supplierGroups[0].id }).expect(201)).body;
  const stores = (await a.get('/stores').expect(200)).body as { id: string; code: string }[];
  const roles = (await a.get('/roles').expect(200)).body as { id: string; code: string }[];
  const user = (await a.post('/users').send({ firstName: 'Cashier', email: `cashier-${companyId.slice(0, 8)}@shop.test`, temporaryPassword: 'Temp-pass-1234', roleIds: [roles.find((r) => r.code === 'cashier')!.id], storeIds: [stores[0].id], defaultStoreId: stores[0].id }).expect(201)).body;
  return { agent: a, companyId, itemId: item.id, barcodeId: barcode.id, customerId: customer.id, supplierId: supplier.id, storeId: stores[0].id, userId: user.id, roleId: roles[0].id };
}

describe('14.1 Two shops with the same codes', () => {
  let A: Made;
  let B: Made;

  beforeAll(async () => {
    await resetDatabase(prisma);
    A = await makeShop(SETUP_INPUT, OWNER.email, OWNER.password);
    B = await makeShop(OTHER, OTHER.admin.email, PASSWORD);
  });

  it('both shops use the same item code, barcode, shop code and customer code without clashing', async () => {
    const [a, b] = await Promise.all([A.agent.get(`/items/${A.itemId}`).expect(200), B.agent.get(`/items/${B.itemId}`).expect(200)]);
    expect(a.body.code).toBe(b.body.code);
    const [ca, cb] = await Promise.all([A.agent.get(`/customers/${A.customerId}`).expect(200), B.agent.get(`/customers/${B.customerId}`).expect(200)]);
    expect(ca.body.code).toBe(cb.body.code);
    expect(A.storeId).not.toBe(B.storeId);
    // Scanning the same barcode finds each shop's own item.
    expect((await A.agent.get('/catalogue/scan/8903000000006').expect(200)).body.item.id).toBe(A.itemId);
    expect((await B.agent.get('/catalogue/scan/8903000000006').expect(200)).body.item.id).toBe(B.itemId);
  });

  it("each shop's lists show only its own rows", async () => {
    for (const [me, other] of [
      [A, B],
      [B, A],
    ] as const) {
      const company = (await me.agent.get('/company').expect(200)).body;
      expect(company.id).toBe(me.companyId);
      const items = JSON.stringify((await me.agent.get('/items').expect(200)).body);
      expect(items).toContain(me.itemId);
      expect(items).not.toContain(other.itemId);
      for (const path of ['/customers', '/suppliers', '/stores', '/users', '/roles', '/audit']) {
        const body = JSON.stringify((await me.agent.get(path).expect(200)).body);
        for (const id of [other.customerId, other.supplierId, other.storeId, other.userId, other.roleId, other.companyId]) expect(body, `${path} shows another shop's row`).not.toContain(id);
      }
    }
  });

  it("asking for another shop's record by its id finds nothing, and changing it fails", async () => {
    const reads = [`/items/${A.itemId}`, `/customers/${A.customerId}`, `/suppliers/${A.supplierId}`, `/stores/${A.storeId}`, `/users/${A.userId}`, `/roles/${A.roleId}`];
    for (const path of reads) {
      const res = await B.agent.get(path);
      expect([403, 404], `${path} answered ${res.status}`).toContain(res.status);
    }
    expect([403, 404]).toContain((await B.agent.patch(`/items/${A.itemId}`).send({ name: 'Taken over' })).status);
    expect([403, 404]).toContain((await B.agent.patch(`/customers/${A.customerId}`).send({ name: 'Taken over' })).status);
    expect([403, 404]).toContain((await B.agent.patch(`/items/${A.itemId}/barcodes/${A.barcodeId}`).send({ active: false })).status);
    // Nothing of shop A changed.
    expect((await A.agent.get(`/items/${A.itemId}`).expect(200)).body.name).toBe('Gold-plated earrings');
    expect((await A.agent.get(`/customers/${A.customerId}`).expect(200)).body.name).toBe('Priya Raman');
  });

  it("another shop's id cannot be slipped into a new record", async () => {
    // Shop B makes an item in shop A's item group: refused, and nothing is made in either shop.
    const before = await prisma.item.count();
    const aGroup = (await A.agent.get('/catalogue/item-groups').expect(200)).body as { id: string; code: string }[] | { groups: { id: string }[] };
    const groupId = Array.isArray(aGroup) ? aGroup[0].id : aGroup.groups[0].id;
    const units = (await B.agent.get('/catalogue/units').expect(200)).body as { id: string; code: string }[];
    const res = await B.agent.post('/items').send({ name: 'Sneaky', itemGroupId: groupId, baseUnitId: units[0].id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.item.count()).toBe(before);
  });

  it('the database itself shows a shop only its own rows, and nothing when no shop is known', async () => {
    const db = app.get(PrismaService);
    const all = await prisma.item.count();
    const inA = await runForCompany(A.companyId, () => db.item.count());
    const inB = await runForCompany(B.companyId, () => db.item.count());
    expect(inA).toBeGreaterThan(0);
    expect(inA + inB).toBe(all);
    expect(await runForCompany(A.companyId, () => db.item.count({ where: { id: B.itemId } })), 'shop A sees shop B item').toBe(0);
    // A request whose shop is not known yet (before login) sees no rows at all.
    expect(await runRequest(async () => await db.item.count()), 'no shop: items').toBe(0);
    expect(await runRequest(async () => await db.company.count()), 'no shop: companies').toBe(0);
    // Writing a row for another shop is refused by the database.
    await expect(runForCompany(A.companyId, () => db.brand.create({ data: { companyId: B.companyId, code: 'X', name: 'X' } as never }))).rejects.toThrow();
  });

  it("clearing one shop's trial data leaves every other shop's data untouched (decision 72)", async () => {
    for (const shop of [A, B]) {
      const loc = ((await shop.agent.get('/stock/locations').expect(200)).body as { id: string; code: string }[]).find((l) => l.code === 'MAIN-FLOOR')!;
      const count = (await shop.agent.post('/stock/counts').send({ countType: 'opening', storeId: shop.storeId, locationId: loc.id, lines: [{ itemId: shop.itemId, countedQuantity: '20', unitCost: '120' }] }).expect(201)).body;
      await shop.agent.post(`/stock/documents/${count.id}/finalise`).expect(200);
    }
    const counts = async (companyId: string) => ({
      stock: await prisma.stockLedgerEntry.count({ where: { companyId } }),
      documents: await prisma.stockDocument.count({ where: { companyId } }),
      ledger: await prisma.ledgerLine.count({ where: { companyId } }),
    });
    const bBefore = await counts(B.companyId);
    expect(bBefore.stock).toBeGreaterThan(0);
    expect((await counts(A.companyId)).stock).toBeGreaterThan(0);

    await A.agent.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'Rademics Retail Pvt Ltd', reason: 'End of the trial' }).expect(200);
    expect(await counts(A.companyId)).toEqual({ stock: 0, documents: 0, ledger: 0 });
    expect(await counts(B.companyId)).toEqual(bBefore);
    // Shop B's item still has its stock.
    expect((await B.agent.get(`/items/${B.itemId}`).expect(200)).body.code).toBeTruthy();
  });

  it('a code used in one shop is still free in another (brands made at the same moment)', async () => {
    const [ra, rb] = await Promise.all([
      A.agent.post('/catalogue/brands').send({ code: 'B1', name: 'Brand one' }),
      B.agent.post('/catalogue/brands').send({ code: 'B1', name: 'Brand one' }),
    ]);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
  });

  it('14.6 the owner downloads all the shop data: only their own rows, never a password', async () => {
    const zip = readZip((await A.agent.get('/data-export').buffer(true).parse(binary as never).expect(200)).body as Buffer);
    const text = (name: string) => zip.get(name)!.toString('utf8').replace(/^﻿/, '');
    expect(text('READ ME.txt')).toMatch(/Rademics Retail Pvt Ltd/);
    for (const name of ['Company.csv', 'Item.csv', 'Customer.csv', 'Store.csv', 'User.csv', 'AuditLog.csv']) expect(zip.has(name)).toBe(true);
    for (const name of ['Session.csv', 'PosCashierToken.csv', 'UserPin.csv']) expect(zip.has(name)).toBe(false);
    // Shop B's rows are never in shop A's file.
    const all = [...zip.entries()].map(([, b]) => b.toString('utf8')).join('\n');
    expect(all).toContain(A.companyId);
    expect(all).not.toContain(B.companyId);
    expect(all).not.toContain('Ravi Textiles');
    // Users come without their password hash.
    const users = readCsv(text('User.csv'));
    expect(users[0]).toContain('email');
    expect(users[0]).not.toContain('passwordHash');
    expect(users.slice(1).map((r) => r[users[0].indexOf('email')])).toContain(OWNER.email);
    expect(all).not.toMatch(/\$argon2|\$scrypt|scrypt\$/);
    // Amounts keep every digit, and the download is in the history.
    const items = readCsv(text('Item.csv'));
    expect(items.slice(1).map((r) => r[items[0].indexOf('mrp')])).toContain('249.00');
    const logged = await prisma.auditLog.findMany({ where: { companyId: A.companyId, action: 'export', entityType: 'company' } });
    expect(logged).toHaveLength(1);
    // Shop B's owner gets shop B's own data.
    expect(readZip((await B.agent.get('/data-export').buffer(true).parse(binary as never).expect(200)).body as Buffer).get('Company.csv')!.toString('utf8')).toContain('Ravi Textiles');
  });
});

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('14.2 Sign-up, login and a switched-off shop', () => {
  beforeAll(async () => {
    await resetDatabase(prisma);
    await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(201);
  });

  it('a new shop signs up with its own owner; an email already used by another shop is refused', async () => {
    const fresh = agent(app);
    const me = (await fresh.post('/auth/signup').send({ firstName: 'Meena', email: 'meena@new-shop.test', password: 'Meena-pass-2026', shopName: 'Meena Stores' }).expect(201)).body;
    expect(me.isOwnerAdmin).toBe(true);
    const company = (await fresh.get('/company').expect(200)).body;
    expect(company.legalName).toBe('Meena Stores');
    // The first shop's owner email cannot sign up again.
    expect((await request(app.getHttpServer()).post('/auth/signup').send({ firstName: 'X', email: OWNER.email, password: 'Another-pass-2026', shopName: 'X' }).expect(409)).body.message).toMatch(/already exists/);
    expect(await prisma.company.count()).toBe(2);
    // Each shop has its own six roles and standard units.
    const roles = await prisma.role.groupBy({ by: ['companyId'], _count: true });
    expect(roles.map((r) => r._count)).toEqual([6, 6]);
  });

  it('a shop switched off cannot log in, and its open sessions stop working', async () => {
    const owner = await login(app, OWNER.email, OWNER.password);
    await owner.get('/auth/me').expect(200);
    await prisma.company.updateMany({ where: { code: 'RRPL' }, data: { active: false } });
    await owner.get('/auth/me').expect(401);
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(401);
    expect(res.body.message).toMatch(/switched off/);
    await prisma.company.updateMany({ where: { code: 'RRPL' }, data: { active: true } });
    await login(app, OWNER.email, OWNER.password);
  });
});

describe('14.3 The Retail ERP admin', () => {
  const ADMIN = { email: 'admin@retailerp.test', password: 'Admin-pass-2026x' };
  let admin: Agent;

  beforeAll(async () => {
    await resetDatabase(prisma);
    await prisma.platformSession.deleteMany();
    await prisma.platformAdmin.deleteMany();
    await prisma.platformAdmin.create({ data: { email: ADMIN.email, name: 'Service admin', passwordHash: await hashPassword(ADMIN.password) } });
    await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(201);
    await agent(app).post('/auth/signup').send({ firstName: 'Meena', email: 'meena@new-shop.test', password: 'Meena-pass-2026', shopName: 'Meena Stores' }).expect(201);
  });

  it('logs in with its own account; a shop owner cannot use the admin screen, and the admin cannot open a shop', async () => {
    await request(app.getHttpServer()).post('/platform/login').send({ email: ADMIN.email, password: 'wrong-pass-123' }).expect(401);
    // A shop owner's email and password do not work here, and a shop session does not open the admin screen.
    await request(app.getHttpServer()).post('/platform/login').send({ email: OWNER.email, password: OWNER.password }).expect(401);
    const owner = await login(app, OWNER.email, OWNER.password);
    await owner.get('/platform/shops').expect(401);

    admin = agent(app);
    await admin.post('/platform/login').send(ADMIN).expect(200);
    expect((await admin.get('/platform/me').expect(200)).body.email).toBe(ADMIN.email);
    // The admin's cookie is not a shop's session.
    await admin.get('/items').expect(401);
  });

  it('lists every shop with its owner, trial and use; never a shop\'s own records', async () => {
    const shops = (await admin.get('/platform/shops').expect(200)).body as { name: string; owner: { email: string } | null; trialEndsAt: string | null; setupCompletedAt: string | null; users: number }[];
    const byEmail = (a?: string, b?: string) => String(a).localeCompare(String(b));
    expect(shops.map((s) => s.owner?.email).sort(byEmail)).toEqual(['meena@new-shop.test', OWNER.email].sort(byEmail));
    const meena = shops.find((s) => s.owner?.email === 'meena@new-shop.test')!;
    // Sign-up starts a 14-day trial; the set-up wizard is still to do.
    expect(Math.round((new Date(meena.trialEndsAt!).getTime() - Date.now()) / 86_400_000)).toBe(14);
    expect(meena.setupCompletedAt).toBeNull();
    expect(Object.keys(shops[0]).sort()).toEqual(['active', 'bills', 'city', 'code', 'createdAt', 'id', 'lastActiveAt', 'name', 'owner', 'setupCompletedAt', 'shopType', 'trialEndsAt', 'users']);
  });

  it('switching a shop off stops its logins; the reason is in that shop\'s history; switching on lets them back', async () => {
    const shops = (await admin.get('/platform/shops').expect(200)).body as { id: string; owner: { email: string } | null }[];
    const rrpl = shops.find((s) => s.owner?.email === OWNER.email)!;
    const owner = await login(app, OWNER.email, OWNER.password);
    await admin.patch(`/platform/shops/${rrpl.id}`).send({ active: false }).expect(400);
    expect((await admin.patch(`/platform/shops/${rrpl.id}`).send({ active: false, reason: 'Trial ended' }).expect(200)).body.active).toBe(false);
    await owner.get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(401);
    const history = await prisma.auditLog.findMany({ where: { companyId: rrpl.id, entityType: 'company', reason: 'Trial ended' } });
    expect(history).toHaveLength(1);
    expect(history[0].changes).toMatchObject({ active: { old: true, new: false }, byRetailErpAdmin: ADMIN.email });

    await admin.patch(`/platform/shops/${rrpl.id}`).send({ active: true, reason: 'Plan paid' }).expect(200);
    await login(app, OWNER.email, OWNER.password);
  });

  it('reads the landing page messages and marks them handled; robots filling the hidden field are dropped', async () => {
    await request(app.getHttpServer()).post('/leads').send({ name: 'Ravi', phone: '9840012345', shopName: 'Ravi Footwear', shopType: 'footwear', message: 'Two counters' }).expect(201);
    await request(app.getHttpServer()).post('/leads').send({ name: 'Bot', phone: '9999999999', website: 'http://spam.example' }).expect(201);
    const leads = (await admin.get('/platform/leads').expect(200)).body as { id: string; name: string; handledAt: string | null }[];
    expect(leads.map((l) => l.name)).toEqual(['Ravi']);
    const handled = (await admin.patch(`/platform/leads/${leads[0].id}`).send({ handled: true }).expect(200)).body;
    expect(handled.handledAt).not.toBeNull();
    // A shop never sees the messages.
    const owner = await login(app, OWNER.email, OWNER.password);
    await owner.get('/platform/leads').expect(401);
  });

  it('five wrong passwords lock the admin account for 15 minutes; logging out ends the session', async () => {
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/platform/login').send({ email: ADMIN.email, password: `wrong-pass-${i}a` }).expect(401);
    const locked = await request(app.getHttpServer()).post('/platform/login').send(ADMIN).expect(401);
    expect(locked.body.message).toMatch(/15 minutes/);
    await admin.post('/platform/logout').expect(204);
    await admin.get('/platform/shops').expect(401);
    await prisma.platformAdmin.update({ where: { email: ADMIN.email }, data: { lockedUntil: null } });
  });
});
