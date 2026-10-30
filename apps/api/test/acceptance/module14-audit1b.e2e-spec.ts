// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 1, open items closed on 28 October 2026: a stranger cannot keep a person locked
// out, a changed password stops an old "forgot password" link, and an offline price that differs
// from the list always goes on the check report.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { MailerService } from '../../src/reports/mailer.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let outbox: { to: string[]; subject: string; text: string }[];
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  outbox = app.select(AuthModule).get(MailerService, { strict: true }).outbox;
  owner = await setUpCompany(app, prisma);
});

afterAll(async () => {
  await app.close();
});

describe('audit 1 follow-ups', () => {
  it('a locked account still lets the person in from a connection they used before, but not a stranger', async () => {
    for (let i = 0; i < 5; i++) await http().post('/auth/login').send({ email: OWNER.email, password: 'Wrong-pass-1234' }).expect(401);
    const user = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // The owner logged in from this connection before (setting up the shop): the right password works.
    await login(app, OWNER.email, OWNER.password);
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    // Someone who never logged in from this connection stays locked out, even with the right password.
    const MAIN = await storeId(prisma, 'MAIN');
    await owner.post('/users').send({ firstName: 'Ravi', email: 'ravi@audit1b.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [MAIN] }).expect(201);
    for (let i = 0; i < 5; i++) await http().post('/auth/login').send({ email: 'ravi@audit1b.test', password: 'Wrong-pass-1234' }).expect(401);
    const refused = await http().post('/auth/login').send({ email: 'ravi@audit1b.test', password: 'Temp-pass-1234' }).expect(401);
    expect(refused.body.message).toMatch(/locked/);
  });

  it('changing the password stops a "forgot password" link sent before', async () => {
    outbox.length = 0;
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    await vi.waitFor(() => expect(outbox).toHaveLength(1), { timeout: 5000 });
    const code = /token=([A-Za-z0-9_-]+)/.exec(outbox[outbox.length - 1].text)![1];
    const me = await login(app, OWNER.email, OWNER.password);
    await me.post('/auth/change-password').send({ currentPassword: OWNER.password, newPassword: 'Changed-pass-2026' }).expect(204);
    await http().post('/auth/reset-password').send({ token: code, newPassword: 'Attacker-pass-2026' }).expect(400);
    owner = await login(app, OWNER.email, 'Changed-pass-2026');
    await owner.post('/auth/change-password').send({ currentPassword: 'Changed-pass-2026', newPassword: OWNER.password }).expect(204);
    owner = await login(app, OWNER.email, OWNER.password);
  });

  it('no email goes to a staff address that was never confirmed or used (owner, #19)', async () => {
    const MAIN = await storeId(prisma, 'MAIN');
    await owner.post('/users').send({ firstName: 'Stranger', email: 'someone@elsewhere.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [MAIN] }).expect(201);
    outbox.length = 0;
    await http().post('/auth/forgot-password').send({ email: 'someone@elsewhere.test' }).expect(200);
    // Audit 11: a mail asked for afterwards does arrive, and it is the only one (a pause alone proved nothing).
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    await vi.waitFor(() => expect(outbox.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(outbox.map((m) => m.to)).toEqual([[OWNER.email]]);
  });

  it('a store manager sees only the staff of their own stores (owner, #24)', async () => {
    await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
    const ANNA = await storeId(prisma, 'ANNA');
    const MAIN = await storeId(prisma, 'MAIN');
    await owner.post('/users').send({ firstName: 'Meena', email: 'meena@audit1b.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'store_manager')], storeIds: [ANNA] }).expect(201);
    const meena = await login(app, 'meena@audit1b.test', 'Temp-pass-1234');
    await meena.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Meena-own-pass-9' }).expect(204);
    const mainOnly = (await owner.post('/users').send({ firstName: 'Kumar', email: 'kumar@audit1b.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [MAIN] }).expect(201)).body;
    const seen = ((await meena.get('/users').expect(200)).body as { email: string }[]).map((u) => u.email);
    expect(seen).toContain('meena@audit1b.test');
    expect(seen).not.toContain('kumar@audit1b.test');
    expect(seen).not.toContain(OWNER.email);
    await meena.get(`/users/${mainOnly.id}`).expect(404);
    expect(((await owner.get('/users').expect(200)).body as { email: string }[]).map((u) => u.email)).toContain('kumar@audit1b.test');
  });

  it('an offline bill sold below the list price goes on "Offline bills to check"', async () => {
    const MAIN = await storeId(prisma, 'MAIN');
    const loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
    const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'BAGS', name: 'Bags' }).expect(201)).body;
    const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
    await owner.post('/pos/gst-rates').send({ hsnCode: '4202', rate: '18', effectiveFrom: '2026-04-01' }).expect(201);
    const bag = (await owner.post('/items').send({ name: 'Handbag', itemGroupId: group.id, baseUnitId: pcs, hsnCode: '4202' }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: list, itemId: bag.id, price: '1000', startDate: '2026-04-01' }).expect(201);
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: bag.id, countedQuantity: '5', unitCost: '500' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    const till = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: list, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body;
    const token = (await owner.post(`/pos/tills/${till.id}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
    const shiftClientId = randomUUID();
    await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: shiftClientId, tillId: till.id, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
    const bill = (
      await owner
        .post('/pos/bills')
        .set('x-till-token', token)
        .send({ clientId: randomUUID(), tillId: till.id, shiftClientId, offline: true, soldAt: new Date().toISOString(), sale: { number: 'MAT1/2627/000001', lines: [{ lineNo: 1, itemId: bag.id, quantity: '1', price: '600' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '600' }] })
    );
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.sale.checkFlags).toContain('price_changed');
  });
});
